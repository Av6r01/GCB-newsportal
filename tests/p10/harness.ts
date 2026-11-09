/**
 * Phase 10 functional-completeness harness (admin management surface).
 *
 * Same isolation model as tests/p7–p9: the REAL Express app from server.ts
 * runs against an ISOLATED JSON store — JSON_DB_PATH / DB_DRIVER set before
 * any module import.
 */
import path from 'path';
import os from 'os';
import fs from 'fs';
import net from 'net';
import http from 'http';

// ── env BEFORE first import of db.ts / server.ts ────────────────────────────
process.env.JSON_DB_PATH = path.join(os.tmpdir(), `gcn-p10-test-db-${process.pid}-${Date.now()}.json`);
process.env.DB_DRIVER = 'json'; // in-memory-store path only (dotenv won't override)
if (!process.env.HOMEPAGE_CACHE_TTL_MS) process.env.HOMEPAGE_CACHE_TTL_MS = '60000';

export const TMP_DB = process.env.JSON_DB_PATH;

export interface TestUser {
  id: string;
  email: string;
  name: string;
  role: string;
  token: string;
}

export interface BuiltFixture {
  db: any;
  app: import('express').Express;
  baseUrl: string;
  close: () => Promise<void>;
  users: Record<'admin' | 'editor' | 'reporter' | 'reader' | 'advMgr', TestUser>;
  category: any;
}

export async function buildFixture(): Promise<BuiltFixture> {
  const { db } = await import('../../src/lib/db.ts');
  const { signAuthToken } = await import('../../src/server/authMiddleware.ts');
  const { buildServer } = await import('../../server.ts') as any;
  const bcrypt = (await import('bcrypt')).default;

  const users: Record<string, TestUser> = {};
  const mkUser = async (id: string, email: string, name: string, role: string) => {
    const passwordHash = await bcrypt.hash('Correct-Horse-9!', 4);
    const user = await db.user.create({
      data: { id, email, name, role, passwordHash, isActive: true },
    });
    users[name] = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      token: signAuthToken({ id: user.id, email: user.email, name: user.name, role: user.role }),
    };
    return users[name];
  };

  await mkUser('usr-p10-admin', 'p10-admin@test.local', 'admin', 'ADMIN');
  await mkUser('usr-p10-editor', 'p10-editor@test.local', 'editor', 'MANAGING_EDITOR');
  await mkUser('usr-p10-reporter', 'p10-reporter@test.local', 'reporter', 'REPORTER');
  await mkUser('usr-p10-reader', 'p10-reader@test.local', 'reader', 'READER');
  await mkUser('usr-p10-adv', 'p10-adv@test.local', 'advMgr', 'ADVERTISING_MANAGER');

  const category = await db.category.create({
    data: { name: 'Phase10 World', slug: 'phase10-world', description: 'test category' },
  });

  const app = await buildServer({ lifespan: false, static: false }).then((b: any) => b.app);

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address() as net.AddressInfo;
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  const close = async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (fs.existsSync(TMP_DB)) fs.rmSync(TMP_DB);
  };

  return { db, app, baseUrl, close, users, category } as any;
}

export interface ApiResponse {
  status: number;
  json: any;
  headers: Headers;
  location?: string;
}

/**
 * JSON API request helper. GET/HEAD never carry a body (harness invariant
 * kept from p8/p9). `token` is the 4th arg.
 */
export async function api(
  baseUrl: string,
  method: 'GET' | 'HEAD' | 'POST' | 'PUT' | 'DELETE',
  pathAndQuery: string,
  token?: string,
  body?: unknown,
): Promise<ApiResponse> {
  const init: RequestInit = {
    method,
    redirect: 'manual',
    headers: {
      ...(body !== undefined && method !== 'GET' && method !== 'HEAD'
        ? { 'Content-Type': 'application/json' }
        : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined && method !== 'GET' && method !== 'HEAD'
      ? { body: JSON.stringify(body) }
      : {}),
  };
  const res = await fetch(`${baseUrl}${pathAndQuery}`, init);
  const location = res.headers.get('location') || undefined;
  const text = await res.text();
  let json: any = undefined;
  try { json = JSON.parse(text); } catch { /* non-JSON (HTML etc.) stays raw */ }
  return { status: res.status, json, headers: res.headers, location };
}

/** Convenience: expect a status and return the parsed JSON body. */
export async function expect(
  baseUrl: string,
  method: 'GET' | 'HEAD' | 'POST' | 'PUT' | 'DELETE',
  pathAndQuery: string,
  token: string | undefined,
  expectedStatus: number,
  body?: unknown,
): Promise<ApiResponse> {
  const res = await api(baseUrl, method, pathAndQuery, token, body);
  if (res.status !== expectedStatus) {
    throw new Error(`expected ${expectedStatus} for ${method} ${pathAndQuery}, got ${res.status}: ${JSON.stringify(res.json)}`);
  }
  return res;
}

/** Raw page fetch (HTML surfaces) with manual redirect handling. */
export async function get(baseUrl: string, pathAndQuery: string, follow = false): Promise<ApiResponse> {
  const res = await fetch(`${baseUrl}${pathAndQuery}`, { redirect: 'manual' });
  const location = res.headers.get('location') || undefined;
  const text = await res.text();
  let json: any = undefined;
  try { json = JSON.parse(text); } catch { /* html */ }
  if (follow && res.status >= 300 && res.status < 400 && location) {
    // Location may be relative ("/article/…") or absolute ("https://host/…")
    return get(baseUrl, location.startsWith('http') ? new URL(location).pathname + new URL(location).search : location);
  }
  return { status: res.status, json, headers: res.headers, location };
}
