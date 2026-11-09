/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phase 11 — local/dev storage provider.
 *
 * This is the ONLY place in the codebase that media writes ever touch the
 * filesystem. Route handlers request operations and never see paths.
 *
 * Features the upload pipeline relies on:
 *   - atomic writes: objects land via temp file + rename, so a crashed write
 *     never leaves a half-written image at its final key;
 *   - key containment: `…/media/../../db.json` style keys refuse to resolve;
 *   - honest visibility: 'public' objects get plain /uploads/<key> paths,
 *     'private' objects get HMAC-signed, expiring /media-signed/... paths
 *     verified by server.ts (no unsigned passthrough);
 *   - enumeration: listObjects() backs orphan reconciliation.
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { env } from '../../configuration/env.ts';
import {
  StorageProvider,
  StorageProviderError,
  type DeleteResult,
  type ObjectVisibility,
  type ReadUrl,
} from './types.ts';
import { assertSafeProviderKeyWithDriver } from './keys.ts';

/** Validate a relative object key: no traversal, no absolute path, safe charset. */
export function assertSafeProviderKey(provider: StorageDriver, key: string): void {
  assertSafeProviderKeyWithDriver(provider, key);
}

export type StorageDriver = 'local' | 's3';

function safeResolve(root: string, key: string): string {
  const resolved = path.resolve(root, key);
  const rooted = path.resolve(root) + path.sep;
  if (!(resolved.startsWith(rooted) || resolved === path.resolve(root))) {
    throw new StorageProviderError('local', 'resolved path escapes the storage root (potential traversal)');
  }
  return resolved;
}

export class LocalStorageProvider implements StorageProvider {
  readonly name = 'local' as const;
  readonly root: string;

  constructor(rootOverride?: string) {
    this.root = path.resolve(rootOverride || env.STORAGE_LOCAL_DIR || path.join(process.cwd(), 'public', 'uploads'));
  }

  /** Creates the root lazily but eagerly enough for static mounts. */
  ensureRoot(): void {
    fs.mkdirSync(this.root, { recursive: true });
  }

  abs(key: string): string {
    assertSafeProviderKey(this.name, key);
    return safeResolve(this.root, key);
  }

  async putObject(key: string, buffer: Buffer, _contentType: string): Promise<void> {
    const abs = this.abs(key);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    // Atomic write: temp file in the SAME directory (same volume → rename is
    // atomic on POSIX and same-drive on Windows), then rename into place.
    const tmp = `${abs}.tmp-${crypto.randomBytes(6).toString('hex')}`;
    try {
      fs.writeFileSync(tmp, buffer);
      fs.renameSync(tmp, abs);
    } catch (err) {
      try { fs.rmSync(tmp, { force: true }); } catch { /* best effort */ }
      throw new StorageProviderError(this.name, `putObject failed: ${(err as any).message ?? err}`);
    }
  }

  async getObject(key: string): Promise<Buffer> {
    try {
      return fs.readFileSync(this.abs(key));
    } catch (err: any) {
      if (err?.code === 'ENOENT') {
        throw new StorageProviderError(this.name, `object not found: ${key}`, 404);
      }
      throw new StorageProviderError(this.name, `getObject failed: ${err?.message ?? err}`);
    }
  }

  async exists(key: string): Promise<boolean> {
    return fs.existsSync(this.abs(key));
  }

  async deleteObject(key: string): Promise<void> {
    try {
      fs.rmSync(this.abs(key), { force: false });
    } catch (err: any) {
      if (err?.code === 'ENOENT') return; // deleting a missing object is a no-op
      throw new StorageProviderError(this.name, `deleteObject failed: ${err?.message ?? err}`);
    }
  }

  async deleteObjects(keys: string[]): Promise<DeleteResult> {
    const deleted: string[] = [];
    const failed: string[] = [];
    for (const key of keys) {
      try {
        await this.deleteObject(key);
        deleted.push(key);
      } catch {
        failed.push(key);
      }
    }
    return { deleted, failed };
  }

  async listObjects(prefix: string): Promise<string[]> {
    const out: string[] = [];
    const base = path.resolve(prefix ? this.abs(prefix) : this.root);
    let walk: (dir: string) => void;
    walk = (dir: string) => {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch (err: any) {
        if (err?.code === 'ENOENT') return;
        throw new StorageProviderError(this.name, `listObjects failed: ${err?.message ?? err}`);
      }
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.isFile()) {
          const rel = path.relative(this.root, full).split(path.sep).join('/');
          if (/\.tmp-/.test(path.basename(rel))) continue; // in-flight atomic-write scratch
          if (!prefix || rel === prefix || rel.startsWith(prefix.endsWith('/') ? prefix : prefix + '/')) {
            out.push(rel);
          }
        }
      }
    };
    walk(base.startsWith(path.resolve(this.root) + path.sep) || base === path.resolve(this.root) ? base : this.root);
    return out.sort();
  }

  /**
   * Local read URLs.
   *  - public:  /uploads/<key> — served by the static mount in server.ts
   *  - private: /media-signed/<expiry>/<sig>/<key> — verified route; the
   *    signature is an HMAC of "key:expiry" keyed with the server secret, so
   *    followers cannot forge or extend access once expired.
   */
  async getReadUrl(key: string, opts?: { visibility?: ObjectVisibility }): Promise<ReadUrl> {
    assertSafeProviderKey(this.name, key);
    const visibility = opts?.visibility || env.STORAGE_MEDIA_VISIBILITY;
    if (visibility === 'private') {
      const { url, expiresAt } = buildLocalSignedPath(key, env.STORAGE_SIGNED_URL_TTL_SECONDS);
      return { url, kind: 'signed', expiresAt };
    }
    return { url: `/uploads/${encodeURI(key)}`, kind: 'public', expiresAt: null };
  }
}

/** HMAC secret for local signed URLs — the validated JWT secret doubles as the signing key. */
function signingSecret(): string {
  return env.JWT_SECRET;
}

export function buildLocalSignedPath(key: string, ttlSeconds: number): { url: string; expiresAt: string; signature: string } {
  assertSafeProviderKey('local', key);
  const expiry = Math.floor(Date.now() / 1000) + ttlSeconds;
  const signature = crypto
    .createHmac('sha256', signingSecret())
    .update(`${key}:${expiry}`)
    .digest('hex');
  return { url: `/media-signed/${expiry}/${signature}/${key}`, expiresAt: new Date(expiry * 1000).toISOString(), signature };
}

export function verifyLocalSignedPath(expiry: string, signature: string, key: string): { valid: boolean; reason?: string } {
  const exp = Number(expiry);
  if (!Number.isFinite(exp) || String(exp).length !== expiry.length) {
    return { valid: false, reason: 'malformed expiry' };
  }
  if (exp * 1000 < Date.now()) {
    return { valid: false, reason: 'expired' };
  }
  const expected = crypto.createHmac('sha256', signingSecret()).update(`${key}:${exp}`).digest('hex');
  const a = Buffer.from(signature, 'utf-8');
  const b = Buffer.from(expected, 'utf-8');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { valid: false, reason: 'signature mismatch' };
  }
  return { valid: true };
}
