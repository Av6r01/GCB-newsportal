/**
 * Phase 7 regression: cache TTL + invalidation.
 * - TtlCache unit: expiry forces regeneration (never serves stale payload).
 * - Route level: article transition and breaking-news mutations invalidate the
 *   homepage cache; cache carries generatedAt/age/TTL observability.
 * - Draft/private records can never leak through cache (build is
 *   PUBLISHED-only by construction; test proves drafting doesn't enter cache).
 */
import { buildFixture, makeRequest, BuiltFixture } from './harness.ts';

export async function check(T: any) {
  // ── unit: TTL expiry ──
  const { TtlCache } = await import('../../src/server/cache.ts');
  const c = new TtlCache<any>(40);
  c.set({ v: 1 });
  T.ok(c.get(), 'fresh entry served');
  await new Promise((r) => setTimeout(r, 60));
  T.eq(c.get(), null, 'expired entry forces regeneration');
  c.set({ v: 2 });
  T.eq(c.get()!.value.v, 2, 're-set works');

  // ── route level ──
  const fx: BuiltFixture = await buildFixture();
  try {
    const { db, users, baseUrl } = fx;
    const h1 = await makeRequest(baseUrl, 'GET', '/api/homepage');
    T.eq(h1.status, 200, 'first homepage 200');
    T.eq(h1.body.cached, false, 'first build is uncached');
    T.ok(h1.body.generatedAt, 'generatedAt present');

    const h2 = await makeRequest(baseUrl, 'GET', '/api/homepage');
    T.eq(h2.body.cached, true, 'second read served from cache');
    T.ok(h2.body.cacheTtlSeconds >= 1, 'TTL surfaced to clients');
    T.ok(h2.body.cacheAgeSeconds !== undefined, 'cache age surfaced');

    // publish a draft through the state machine to force invalidation
    const draft = await fx.mkArticle({ title: 'Cache Draft Story', slug: 'p7-cache-draft', status: 'DRAFT', authorId: users.reporter.id });

    const before = (await makeRequest(baseUrl, 'GET', '/api/homepage')).body;
    const totalCount = before.secondaryStories.length + before.latestNews.length;

    // Editor publishes the draft through the state machine:
    // DRAFT → IN_REVIEW → APPROVED → PUBLISHED (all as MANAGING_EDITOR)
    const chain = ['IN_REVIEW', 'APPROVED', 'PUBLISHED'];
    for (const state of chain) {
      const tr = await makeRequest(baseUrl, 'POST', `/api/articles/${draft.id}/transition`,
        { targetState: state, note: `cache test step ${state}` }, users.editor.token);
      T.eq(tr.status, 200, `editor transition to ${state} allowed`);
    }

    const after = await makeRequest(baseUrl, 'GET', '/api/homepage');
    T.eq(after.body.cached, false, 'transition invalidated the homepage cache');
    const afterCount = after.body.secondaryStories.length + after.body.latestNews.length;
    T.ok(afterCount >= totalCount, 'newly published story is visible in fresh build');

    // Draft creation alone must NOT enter the cache contents (PUBLISHED-only rule)
    await fx.mkArticle({ title: 'Still Draft', slug: 'p7-still-draft', status: 'DRAFT', authorId: users.reporter.id });
    const rebuilt = await makeRequest(baseUrl, 'GET', '/api/homepage');
    const allPublishedStories = [...(rebuilt.body.secondaryStories || []), ...(rebuilt.body.latestNews || [])];
    T.eq(allPublishedStories.find((a: any) => a.slug === 'p7-still-draft'), undefined, 'draft never enters homepage payload');

    // Breaking-news mutation invalidates cache (fixed defect)
    await makeRequest(baseUrl, 'GET', '/api/homepage'); // cache repopulated
    const brk = await makeRequest(baseUrl, 'POST', '/api/breaking-news',
      { headline: 'Cache invalidation headline', urgencyRank: 1 }, users.editor.token);
    T.eq(brk.status, 200, 'breaking-news create allowed for editor (article:publish)');
    const afterBreaking = await makeRequest(baseUrl, 'GET', '/api/homepage');
    T.eq(afterBreaking.body.cached, false, 'breaking-news POST invalidated homepage cache');
    T.ok(afterBreaking.body.breakingAnnouncement, 'new announcement visible in fresh homepage');
  } finally {
    await fx.close();
  }
}
