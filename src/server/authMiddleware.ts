/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Authentication middleware — Phase 4 hardened.
 *
 * Changes from Phase 3 baseline:
 *   - JWT_SECRET sourced exclusively from validated env config (no local fallback).
 *   - Algorithm restricted to HS256 on every jwt.verify call.
 *   - jti (JWT ID) checked against durable revokedSessions store in DB.
 *   - passwordChangedAt checked: tokens issued before password change are rejected.
 *   - Durable LoginRateLimiter + PasswordResetRateLimiter (in-memory sliding window;
 *     restart clears counts but not a security risk — window is 5 min).
 *   - revokedTokens Set REMOVED — replaced by DB-backed revokedSession.isRevoked(jti).
 */

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { db } from '../lib/database.ts';
import { hasPermission, Permission, RoleType } from '../modules/auth/permissions.ts';
import { env } from '../configuration/env.ts';

// ── Canonical secret from validated config — no local fallback ────────────────
const JWT_SECRET = env.JWT_SECRET;
const JWT_ALGORITHM = 'HS256' as const;

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
  role: RoleType;
  isActive: boolean;
  jti?: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
      sessionToken?: string;
    }
  }
}

// ── Login Rate Limiter (sliding window, in-memory) ────────────────────────────
interface RateLimitEntry {
  attempts: number;
  blockedUntil?: number;
  lastAttempt: number;
}

class LoginRateLimiter {
  private limits = new Map<string, RateLimitEntry>();
  private readonly maxAttempts = 5;
  private readonly blockDurationMs = 15 * 60_000; // 15 minutes
  private readonly windowMs = 5 * 60_000;          // 5 minutes

  isBlocked(key: string): { blocked: boolean; remainingSec?: number } {
    const entry = this.limits.get(key);
    if (!entry) return { blocked: false };
    const now = Date.now();
    if (entry.blockedUntil && entry.blockedUntil > now) {
      return { blocked: true, remainingSec: Math.ceil((entry.blockedUntil - now) / 1000) };
    }
    if (entry.blockedUntil && entry.blockedUntil <= now) {
      this.limits.delete(key);
    }
    return { blocked: false };
  }

  recordFailure(key: string) {
    const now = Date.now();
    const entry = this.limits.get(key) || { attempts: 0, lastAttempt: now };
    entry.attempts = (now - entry.lastAttempt > this.windowMs) ? 1 : entry.attempts + 1;
    entry.lastAttempt = now;
    if (entry.attempts >= this.maxAttempts) entry.blockedUntil = now + this.blockDurationMs;
    this.limits.set(key, entry);
  }

  recordSuccess(key: string) { this.limits.delete(key); }
}

export const loginRateLimiter       = new LoginRateLimiter();
export const passwordResetRateLimiter = new LoginRateLimiter();

/**
 * Sign a JWT with a unique jti and algorithm restriction.
 * Call this instead of jwt.sign directly so signing config is centralised.
 */
export function signAuthToken(payload: { id: string; email: string; role: string; name: string }): string {
  const jti = `${payload.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return jwt.sign(
    { ...payload, jti },
    JWT_SECRET,
    {
      algorithm: JWT_ALGORITHM,
      expiresIn: env.JWT_EXPIRES_IN_SECONDS,
      issuer: 'global-chronicle-news',
      audience: 'gcn-client',
    }
  );
}

/**
 * Verify a JWT with strict algorithm and claims checks.
 */
export function verifyAuthToken(token: string): jwt.JwtPayload {
  return jwt.verify(token, JWT_SECRET, {
    algorithms: [JWT_ALGORITHM],
    issuer: 'global-chronicle-news',
    audience: 'gcn-client',
  }) as jwt.JwtPayload;
}

/**
 * requireAuth — verifies token, checks revocation, checks passwordChangedAt.
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const token = req.headers['authorization']?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Authentication required.' });

    let decoded: jwt.JwtPayload;
    try {
      decoded = verifyAuthToken(token);
    } catch {
      return res.status(401).json({ error: 'Invalid or expired session token.' });
    }

    const jti = decoded.jti as string | undefined;

    // Check durable revocation store
    if (jti && await db.revokedSession.isRevoked(jti)) {
      return res.status(401).json({ error: 'Session has been invalidated. Please sign in again.' });
    }

    const user = await db.user.findUnique({ where: { id: decoded.id } });
    if (!user) return res.status(401).json({ error: 'User account no longer exists.' });
    if (user.isActive === false) return res.status(403).json({ error: 'Account has been deactivated.' });

    // Reject tokens issued before the user's last password change
    if (user.passwordChangedAt) {
      const changedAt = Math.floor(new Date(user.passwordChangedAt).getTime() / 1000);
      if ((decoded.iat ?? 0) < changedAt) {
        return res.status(401).json({ error: 'Session expired after password change. Please sign in again.' });
      }
    }

    req.user = { id: user.id, email: user.email, name: user.name, role: user.role as RoleType, isActive: user.isActive, jti };
    req.sessionToken = token;
    next();
  } catch (err: any) {
    return res.status(500).json({ error: 'Internal authentication error.' });
  }
}

/**
 * optionalAuth — Phase 8: same verification as requireAuth, but anonymous/invalid
 * tokens never abort the request; a VALID token attaches req.user so routes can
 * serve both public and editorial views (e.g. GET /api/comments status filters).
 * Invalid tokens are treated as anonymous (no error) — privilege checks on the
 * route read req.user, which stays unset.
 */
export async function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const token = req.headers['authorization']?.split(' ')[1];
    if (token) {
      let decoded: jwt.JwtPayload;
      try {
        decoded = verifyAuthToken(token);
      } catch {
        decoded = undefined as unknown as jwt.JwtPayload;
      }
      if (decoded) {
        const jti = decoded.jti as string | undefined;
        if (!(jti && await db.revokedSession.isRevoked(jti))) {
          const user = await db.user.findUnique({ where: { id: decoded.id } });
          if (user && user.isActive !== false) {
            // Reject tokens issued before the user's last password change
            let passwordOk = true;
            if (user.passwordChangedAt) {
              const changedAt = Math.floor(new Date(user.passwordChangedAt).getTime() / 1000);
              passwordOk = (decoded.iat ?? 0) >= changedAt;
            }
            if (passwordOk) {
              req.user = { id: user.id, email: user.email, name: user.name, role: user.role as RoleType, isActive: user.isActive, jti };
              req.sessionToken = token;
            }
          }
        }
      }
    }
    next();
  } catch {
    next(); // auth is OPTIONAL here — never break the request on lookup hiccups
  }
}

/**
 * requirePermission — checks granular permission on the authenticated user.
 */
export function requirePermission(permission: Permission) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required.' });
    if (!hasPermission(req.user.role, permission)) {
      return res.status(403).json({ error: `Permission denied: ${permission}` });
    }
    next();
  };
}

/**
 * requireStoryAccess — ownership + permission guard for article operations.
 */
export function requireStoryAccess(operation: 'edit' | 'delete' | 'publish') {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required.' });
    const article = await db.article.findUnique({ where: { id: req.params.id } });
    if (!article) return res.status(404).json({ error: 'Article not found.' });

    if (operation === 'publish') {
      return hasPermission(req.user.role, 'article:publish')
        ? next()
        : res.status(403).json({ error: 'Permission denied: article:publish' });
    }
    if (operation === 'delete') {
      return hasPermission(req.user.role, 'article:delete')
        ? next()
        : res.status(403).json({ error: 'Permission denied: article:delete' });
    }
    // edit
    if (hasPermission(req.user.role, 'article:edit_any') ||
        (hasPermission(req.user.role, 'article:edit_own') && article.authorId === req.user.id)) {
      return next();
    }
    return res.status(403).json({ error: 'Permission denied: cannot edit another author\'s article.' });
  };
}

/**
 * preventPrivilegeEscalation — guards role assignment hierarchy.
 */
export function preventPrivilegeEscalation(req: Request, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ error: 'Authentication required.' });
  const targetRole: RoleType = req.body.role;
  if (!targetRole) return next();
  if ((targetRole === 'SUPER_ADMIN' || targetRole === 'ADMIN') && req.user.role !== 'SUPER_ADMIN') {
    return res.status(403).json({ error: 'Privilege escalation rejected: only Super Administrators can grant admin roles.' });
  }
  next();
}

// Keep revokedTokens exported for any legacy imports — now a no-op shim
export const revokedTokens = { add: (_: string) => {}, has: (_: string) => false };
