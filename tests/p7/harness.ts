/**
 * Phase 7 regression-test harness.
 *
 * Runs the REAL Express app from server.ts (buildServer) against an ISOLATED
 * JSON store — the process env JSON_DB_PATH redirects the legacy driver's file
 * so production data/database.json can never be touched by these tests.
 *
 * IMPORTANT: JSON_DB_PATH and HOMEPAGE_CACHE_TTL_MS must be set BEFORE any
 * module that reads them is imported.
 */
import path from 'path';
import os from 'os';
import fs from 'fs';
import net from 'net';
import http from 'http';

// ── env BEFORE first import of src/lib/db.ts / server.ts ────────────────────
process.env.JSON_DB_PATH = path.join(os.tmpdir(), `gcn-p7-test-db-${process.pid}-${Date.now()}.json`);
process.env.DB_DRIVER = 'json'; // tests always run the in-memory-store path (dotenv won't override)
process.env.HOMEPAGE_CACHE_TTL_MS = process.env.HOMEPAGE_CACHE_TTL_MS || '60000';

export const TMP_DB = process.env.JSON_DB_PATH;

export interface TestUser {
  id: string;
  email: string;
  name: string;
  role: string;
  token?: string;
}

export interface BuiltFixture {
  db: any; // the shared JSON persistence driver (route imports resolve to the same singleton)
  app: import('express').Express;
  baseUrl: string;
  close: () => Promise<void>;
  users: Record<'admin' | 'editor' | 'reporter' | 'purger', TestUser>;
  category: any;
  mkArticle: (opts: { title: string; slug: string; status?: string; authorId?: string }) => Promise<TestArticle>;
  /** Direct row read bypassing any repo logic (bypasses repo side-effects). */
  readArticle: (id: string) => any;
}

export interface TestArticle {
  id: string;
  slug: string;
  categoryId: string;
  authorId: string;
}

export async function buildFixture(): Promise<BuiltFixture> {
  // Import order matters: db first (reads env), then server (builds routes)
  const { db } = await import('../../src/lib/db.ts');
  const { signAuthToken } = await import('../../src/server/authMiddleware.ts');
  const SERVER = await import('../../server.ts');
  const buildServer = (SERVER as any).buildServer;

  const bcrypt = (await import('bcrypt')).default;

  const mkUser = async (id: string, email: string, name: string, role: string) => {
    const passwordHash = await bcrypt.hash('Correct-Horse-9!', 4);
    const user = await db.user.create({
      data: {
        id,
        email,
        name,
        role,
        passwordHash,
        isActive: true,
      },
    });
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      token: signAuthToken({ id: user.id, email: user.email, name: user.name, role: user.role }),
    };
  };

  const users = {
    admin:   await mkUser('usr-p7-admin',  'p7-admin@test.local',  'P7 Admin',  'ADMIN'),
    purger:  await mkUser('usr-p7-purger', 'p7-purger@test.local', 'P7 Purger', 'SUPER_ADMIN'),
    editor:  await mkUser('usr-p7-editor', 'p7-editor@test.local', 'P7 Editor', 'MANAGING_EDITOR'),
    reporter: await mkUser('usr-p7-reporter', 'p7-reporter@test.local', 'P7 Reporter', 'REPORTER'),
  };

  // Category needed by article creation
  const category = await db.category.create({
    data: { name: 'Phase7 World', slug: 'phase7-world', description: 'test category' },
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

  return {
    db, app, baseUrl, close, users, category, mkArticle, makeRequest, readArticle,
  } as any;

  /** Direct row read bypassing repo side-effect logic. */
  function readArticle(id: string) {
    return db.data.articles.find((a: any) => a.id === id) || null;
  }

  /** Direct driver seeding used by suites. All lies in helper scope above. */
  async function mkArticle(opts: {
    title: string;
    slug: string;
    status?: string;
    authorId?: string;
  }): Promise<TestArticle> {
    const art: any = await db.article.create({
      data: {
        title: opts.title,
        slug: opts.slug,
        excerpt: 'Phase 7 test excerpt',
        content: '<p>Phase 7 test content</p>',
        coverImage: 'https://example.test/cover.jpg',
        categoryId: category.id,
        authorId: opts.authorId || users.reporter.id,
        status: opts.status || 'DRAFT',
      },
    });
    return { id: art.id, slug: art.slug, categoryId: art.categoryId, authorId: art.authorId };
  }
}

export async function makeRequest(
  baseUrl: string,
  method: string,
  urlPath: string,
  body?: any,
  token?: string,
): Promise<{ status: number; body: any; headers: any }> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${baseUrl}${urlPath}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    redirect: 'manual', // observe 3xx as data, not follow
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { status: res.status, body: json, headers: res.headers };
}
