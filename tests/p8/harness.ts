/**
 * Phase 8 regression-test harness.
 *
 * Same isolation model as tests/p7: the REAL Express app from server.ts
 * (buildServer) runs against an ISOLATED JSON store — JSON_DB_PATH/DB_DRIVER
 * are set before any module import so the production data/database.json can
 * never be touched. Rate limits are read from env at import time; tests run
 * with per-suite env injected by tests/p8/run.ts (spawn arguments).
 */
import path from 'path';
import os from 'os';
import fs from 'fs';
import net from 'net';
import http from 'http';

// ── env BEFORE first import of src/lib/db.ts / server.ts ────────────────────
process.env.JSON_DB_PATH = path.join(os.tmpdir(), `gcn-p8-test-db-${process.pid}-${Date.now()}.json`);
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
  users: Record<'admin' | 'editor' | 'reporter' | 'reader', TestUser>;
  category: any;
  usersCount: number;
}

export interface P8RequestResult {
  status: number;
  body: any;
  headers: Headers;
  /** Raw cookie string captured from Set-Cookie (fname=value; attrs). */
  setCookie?: string;
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

  await mkUser('usr-p8-admin', 'p8-admin@test.local', 'admin', 'ADMIN');
  await mkUser('usr-p8-editor', 'p8-editor@test.local', 'editor', 'MANAGING_EDITOR');
  await mkUser('usr-p8-reporter', 'p8-reporter@test.local', 'reporter', 'REPORTER');
  await mkUser('usr-p8-reader', 'p8-reader@test.local', 'reader', 'READER');

  const category = await db.category.create({
    data: { name: 'Phase8 World', slug: 'phase8-world', description: 'test category' },
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

/** Create a PUBLISHED article and return its id/slug. */
export async function mkPublishedArticle(fx: BuiltFixture, title: string, slug: string): Promise<any> {
  const art: any = await fx.db.article.create({
    data: {
      title, slug,
      excerpt: 'Phase 8 test excerpt',
      content: '<p>Phase 8 test content</p>',
      coverImage: 'https://example.test/cover.jpg',
      categoryId: fx.category.id,
      authorId: fx.users.reporter.id,
      status: 'PUBLISHED',
    },
  });
  return art;
}

/**
 * Request helper with cookie passing: pass `cookie` to send a Cookie header;
 * the result carries the raw `set-cookie` value when the server sets one.
 */
export async function makeRequest(
  baseUrl: string,
  method: string,
  urlPath: string,
  body?: any,
  token?: string,
  cookie?: string,
): Promise<P8RequestResult> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  if (cookie) headers.cookie = cookie;
  const res = await fetch(`${baseUrl}${urlPath}`, {
    method,
    headers,
    // GET/HEAD requests cannot carry a body (fetch throws) — drop it
    body: body !== undefined && !['GET', 'HEAD'].includes(method.toUpperCase())
      ? (typeof body === 'string' ? body : JSON.stringify(body))
      : undefined,
    redirect: 'manual',
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { status: res.status, body: json, headers: res.headers, setCookie: res.headers.get('set-cookie') || undefined };
}
