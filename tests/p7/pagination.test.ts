/**
 * Phase 7 regression: pagination contract on GET /api/articles.
 * - page present → { articles, pagination } envelope, limits sanitized
 * - limit without page → plain array honoring limit (the fixed defect)
 * - hostile values (NaN, negatives, huge limits) clamped, never throw
 */
import { buildFixture, makeRequest, BuiltFixture } from './harness.ts';

export async function check(T: any) {
  const fx: BuiltFixture = await buildFixture();
  try {
    const { db, users, baseUrl } = fx;
    // seed 12 published articles
    for (let i = 1; i <= 12; i++) {
      await db.article.create({
        data: {
          title: `P7 Pagination Story ${i}`,
          slug: `p7-pagination-${i}`,
          excerpt: 'ex', content: '<p>c</p>', coverImage: '',
          categoryId: fx.category.id, authorId: users.reporter.id, status: 'PUBLISHED',
        },
      });
    }

    // 1. page present → envelope
    const paged = await makeRequest(baseUrl, 'GET', '/api/articles?page=2&limit=5');
    T.eq(paged.status, 200, 'paged request 200');
    T.ok(Array.isArray(paged.body.articles), 'envelope carries articles array');
    T.eq(paged.body.articles.length, 5, 'take honored');
    T.eq(paged.body.pagination.page, 2, 'page echoed');
    T.eq(paged.body.pagination.limit, 5, 'limit echoed');
    T.eq(paged.body.pagination.total, 12, 'total counted');

    // 2. limit WITHOUT page → array of exactly limit items (fixed defect)
    const limitOnly = await makeRequest(baseUrl, 'GET', '/api/articles?limit=5');
    T.eq(limitOnly.status, 200, 'limit-only request 200');
    T.ok(Array.isArray(limitOnly.body), 'limit-only returns plain array (App.tsx contract)');
    T.eq(limitOnly.body.length, 5, 'limit-only honored: exactly 5 items');

    // legacy behavior preserved: no page, no limit → full corpus array
    const bare = await makeRequest(baseUrl, 'GET', '/api/articles');
    T.ok(Array.isArray(bare.body), 'bare request returns plain array');
    T.eq(bare.body.length, 12, 'bare request returns full corpus');

    // 3. hostile inputs clamped, not exploded
    const huge = await makeRequest(baseUrl, 'GET', '/api/articles?limit=99999999');
    T.ok(Array.isArray(huge.body), 'huge limit stays array');
    T.ok(huge.body.length <= 12, 'huge limit cannot exceed corpus on pageless mode');

    const hugePaged = await makeRequest(baseUrl, 'GET', '/api/articles?page=1&limit=99999999');
    T.eq(hugePaged.body.pagination.limit, 100, 'huge limit clamped to MAX_PAGE_SIZE=100');
    T.eq(hugePaged.body.articles.length, 12, 'clamped take still within corpus');

    const negative = await makeRequest(baseUrl, 'GET', '/api/articles?page=-1&limit=-5&foo=1');
    T.eq(negative.status, 200, 'negative values do not throw');
    T.eq(negative.body.pagination.limit, 20, 'negative limit falls back to default 20');
    T.eq(negative.body.pagination.page, 1, 'negative page falls back to default 1');

    const nan = await makeRequest(baseUrl, 'GET', '/api/articles?page=abc&limit=NaN');
    T.eq(nan.status, 200, 'NaN values do not throw');
    T.eq(nan.body.pagination.limit, 20, 'NaN limit falls back to default 20');
  } finally {
    await fx.close();
  }
}
