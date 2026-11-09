/**
 * Phase 9 regression-test harness (public URLs & News SEO).
 *
 * Same isolation model as tests/p7 + tests/p8: the REAL Express app from
 * server.ts (buildServer) runs against an ISOLATED JSON store — JSON_DB_PATH /
 * DB_DRIVER are set before any module import. APP_URL (the canonical origin all
 * sitemap/canonical/JSON-LD URLs are built from) is injected per-suite by
 * tests/p9/run.ts BEFORE the child imports the app — seo.ts reads env at import.
 *
 * Unlike p8, these suites exercise the RAW HTML/XML surface (deep links,
 * sitemaps, injection output) rather than the JSON API.
 */
import path from 'path';
import os from 'os';
import fs from 'fs';
import net from 'net';
import http from 'http';

// ── env BEFORE first import of seo.ts / db.ts / server.ts ───────────────────
process.env.JSON_DB_PATH = path.join(os.tmpdir(), `gcn-p9-test-db-${process.pid}-${Date.now()}.json`);
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
  childCategory: any;
}

export interface RawResponse {
  status: number;
  body: string;
  headers: Headers;
  location?: string;
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

  await mkUser('usr-p9-admin', 'p9-admin@test.local', 'admin', 'ADMIN');
  await mkUser('usr-p9-editor', 'p9-editor@test.local', 'editor', 'MANAGING_EDITOR');
  await mkUser('usr-p9-reporter', 'p9-reporter@test.local', 'reporter', 'REPORTER');
  await mkUser('usr-p9-reader', 'p9-reader@test.local', 'reader', 'READER');

  const category = await db.category.create({
    data: { name: 'Phase9 World', slug: 'phase9-world', description: 'test parent category' },
  });
  // Subcategory for /category/:parent/:child routes
  const childCategory = await db.category.create({
    data: { name: 'Phase9 Economy', slug: 'phase9-economy', description: 'test child', parentId: category.id },
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

  return { db, app, baseUrl, close, users, category, childCategory } as any;
}

export interface ArticleSpec {
  title: string;
  slug: string;
  status?: 'PUBLISHED' | 'DRAFT' | 'ARCHIVED' | 'PENDING_REVIEW';
  excerpt?: string;
  content?: string;
  publishedAt?: string;
}

export async function mkArticle(fx: BuiltFixture, spec: ArticleSpec): Promise<any> {
  const art: any = await fx.db.article.create({
    data: {
      title: spec.title,
      slug: spec.slug,
      excerpt: spec.excerpt ?? 'Phase 9 excerpt',
      content: spec.content ?? '<p>Phase 9 article body text for crawler checks.</p>',
      coverImage: 'https://media.example.org/cover.jpg',
      categoryId: fx.category.id,
      authorId: fx.users.reporter.id,
      status: spec.status ?? 'PUBLISHED',
    },
  });
  if (spec.publishedAt !== undefined) {
    await fx.db.article.update({ where: { id: art.id }, data: { publishedAt: spec.publishedAt } });
  }
  return art;
}

/**
 * Raw HTML/XML request helper (no JSON parsing — we assert the true bytes).
 * `follow` re-requests the Location of a 3xx once (manual redirect handling).
 */
export async function get(
  baseUrl: string,
  pathAndQuery: string,
  follow = false,
): Promise<RawResponse> {
  const res = await fetch(`${baseUrl}${pathAndQuery}`, { redirect: 'manual' });
  const location = res.headers.get('location') || undefined;
  const body = await res.text();
  if (follow && res.status >= 300 && res.status < 400 && location) {
    const next = await fetch(location.startsWith('http') ? location : `${baseUrl}${location}`, { redirect: 'manual' });
    const nextBody = await next.text();
    return { status: next.status, body: nextBody, headers: next.headers, location: next.headers.get('location') || undefined };
  }
  return { status: res.status, body, headers: res.headers, location };
}

/** Absolute APP_URL the suites expect (same value as tests/p9/run.ts env). */
export const TEST_APP_URL = 'https://press.example.org';
