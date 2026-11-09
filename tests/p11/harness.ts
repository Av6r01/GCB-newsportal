/**
 * Phase 11 storage harness (real provider pipelines).
 *
 * Same isolation model as tests/p7–p10: the REAL Express app from server.ts
 * runs against an ISOLATED JSON store AND an ISOLATED storage directory —
 * STORAGE_DRIVER / STORAGE_LOCAL_DIR / JSON_DB_PATH are set BEFORE any module
 * import (env.ts evaluates storage config at import time).
 *
 * Default driver here is `local`; the S3 integration suite starts ITS OWN
 * in-process S3-compatible HTTP server and re-points the child env at it
 * before importing (no external service, no real bucket — per the Phase 11
 * rule that tests never touch user media to an external service).
 */
import path from 'path';
import os from 'os';
import fs from 'fs';
import net from 'net';
import http from 'http';

// ── env BEFORE first import of env.ts / db.ts / server.ts ────────────────────
process.env.JSON_DB_PATH = path.join(os.tmpdir(), `gcn-p11-test-db-${process.pid}-${Date.now()}.json`);
process.env.DB_DRIVER = 'json'; // in-memory-store path only (dotenv won't override)
process.env.STORAGE_DRIVER = process.env.STORAGE_DRIVER || 'local';
process.env.STORAGE_MEDIA_VISIBILITY = process.env.STORAGE_MEDIA_VISIBILITY || 'public';
process.env.STORAGE_LOCAL_DIR = process.env.STORAGE_LOCAL_DIR || path.join(os.tmpdir(), `gcn-p11-storage-${process.pid}-${Date.now()}`);
if (!process.env.HOMEPAGE_CACHE_TTL_MS) process.env.HOMEPAGE_CACHE_TTL_MS = '60000';

export const TMP_DB = process.env.JSON_DB_PATH;
export const STORAGE_DIR = process.env.STORAGE_LOCAL_DIR;

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
  storageRoot: string;
  store: any;
  close: () => Promise<void>;
  users: Record<'admin' | 'reporter' | 'reader', TestUser>;
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

  await mkUser('usr-p11-admin', 'p11-admin@test.local', 'admin', 'ADMIN');
  await mkUser('usr-p11-reporter', 'p11-reporter@test.local', 'reporter', 'REPORTER');
  await mkUser('usr-p11-reader', 'p11-reader@test.local', 'reader', 'READER');

  const category = await db.category.create({
    data: { name: 'Phase11 World', slug: 'phase11-world', description: 'test category' },
  });

  const app = await buildServer({ lifespan: false, static: false }).then((b: any) => b.app);
  // The provider was resolved inside server.ts; surface its local root for
  // containment assertions (only meaningful for the local driver).
  const { resolveStorageProvider } = await import('../../src/server/storage/index.ts');
  const { LocalStorageProvider } = await import('../../src/server/storage/local.ts');
  const provider = resolveStorageProvider();
  const storageRoot = provider instanceof LocalStorageProvider ? provider.root : null;

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address() as net.AddressInfo;
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  const close = async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (fs.existsSync(TMP_DB)) fs.rmSync(TMP_DB);
  };

  return { db, app, baseUrl, storageRoot, store: db, close, users, category } as unknown as BuiltFixture;
}

export interface ApiResponse {
  status: number;
  json: any;
  headers: Headers;
  location?: string;
  bodyText?: string;
}

/**
 * JSON API request helper. GET/HEAD never carry a body (harness invariant
 * kept from p8–p10). `token` is the 4th arg.
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
  try { json = JSON.parse(text); } catch { /* non-JSON stays raw */ }
  return { status: res.status, json, headers: res.headers, location, bodyText: text };
}

/** Multipart file upload helper mirroring the real admin upload form. */
export async function uploadFile(
  baseUrl: string,
  pathAndQuery: string,
  token: string,
  file: { filename: string; contentType: string; buffer: Buffer },
): Promise<ApiResponse> {
  const boundary = `gc-p11-${Date.now().toString(36)}`;
  const parts: Buffer[] = [];
  parts.push(Buffer.from(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="${file.filename}"\r\n` +
    `Content-Type: ${file.contentType}\r\n\r\n`,
    'utf-8',
  ));
  parts.push(file.buffer);
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`, 'utf-8'));
  const body = Buffer.concat(parts);
  const res = await fetch(`${baseUrl}${pathAndQuery}`, {
    method: 'POST',
    headers: {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      Authorization: `Bearer ${token}`,
    },
    body: new Uint8Array(body),
  });
  const text = await res.text();
  let json: any = undefined;
  try { json = JSON.parse(text); } catch { /* non-JSON */ }
  return { status: res.status, json, headers: res.headers };
}

/** Expect a status and return the parsed JSON body (throws with context). */
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
