/**
 * Phase 7 regression: archive-safe deletion + protected purge + slug redirects.
 * - DELETE /api/articles/:id archives (status ARCHIVED) and PRESERVES
 *   revisions/comments/media joins/history; no cascade destruction.
 * - POST /api/articles/:id/purge is admin-only, blocked while the story is live,
 *   blocked while referenced, and atomically audited when it does run.
 * - Slug changes create UrlRedirect; GET miss on old slug 301s to new path.
 */
import { buildFixture, makeRequest, BuiltFixture } from './harness.ts';

export async function check(T: any) {
  const fx: BuiltFixture = await buildFixture();
  try {
    const { db, users, baseUrl, category } = fx;

    // ── DELETE is archive-by-default ──
    const art: any = await db.article.create({
      data: {
        title: 'Archive Me', slug: 'p7-archive-me', excerpt: 'e',
        content: 'rev-1-content', coverImage: '', categoryId: category.id,
        authorId: users.reporter.id, status: 'PUBLISHED',
      },
    });
    // content change → creates revision v2 in the JSON driver
    await db.article.update({ where: { id: art.id }, data: { content: 'rev-2-content' } });
    await db.comment.create({
      data: { articleId: art.id, authorName: 'Reader', authorEmail: 'r@test.local', content: 'first!', status: 'APPROVED' },
    });

    const del = await makeRequest(baseUrl, 'DELETE', `/api/articles/${art.id}`, undefined, users.editor.token);
    T.eq(del.status, 200, 'editor with article:delete can archive');
    T.eq(del.body.archived, true, 'response marks archived (not deleted)');

    const stored = fx.readArticle(art.id);
    T.eq(stored.status, 'ARCHIVED', 'status is ARCHIVED (never hard delete)');
    T.ok(stored.archivedAt, 'archivedAt stamped');

    // history preserved
    const revs = db.data.articleRevisions.filter((r: any) => r.articleId === art.id);
    T.ok(revs.length >= 2, 'revisions preserved through archive');
    const cmts = db.data.comments.filter((c: any) => c.articleId === art.id);
    T.eq(cmts.length, 1, 'comments preserved through archive');

    // archived content is gone from public detail read
    const publicRead = await makeRequest(baseUrl, 'GET', `/api/articles/${art.slug}`);
    T.eq(publicRead.status, 404, 'archived story 404s for public callers');

    const delAgain = await makeRequest(baseUrl, 'DELETE', `/api/articles/${art.id}`, undefined, users.editor.token);
    T.eq(delAgain.status, 200, 'double archive is idempotent and safe');

    // ── purge protections ──
    const editorPurge = await makeRequest(baseUrl, 'POST', `/api/articles/${art.id}/purge`, undefined, users.editor.token);
    T.eq(editorPurge.status, 403, 'MANAGING_EDITOR (article:delete only) cannot purge');

    const reporterPurge = await makeRequest(baseUrl, 'POST', `/api/articles/${art.id}/purge`, undefined, users.reporter.token);
    T.eq(reporterPurge.status, 403, 'REPORTER cannot purge');

    const purge = await makeRequest(baseUrl, 'POST', `/api/articles/${art.id}/purge`, undefined, users.purger.token);
    T.eq(purge.status, 200, 'SUPER_ADMIN purges an archived story');
    T.eq(fx.readArticle(art.id), null, 'article row gone after purge');
    const purgedLog = db.data.auditLogs.filter((l: any) => l.action === 'ARTICLE_PURGED' && l.entityId === art.id);
    T.eq(purgedLog.length, 1, 'purge audited exactly once');

    // purge blocked before archive for live stories
    const live = await db.article.create({
      data: { title: 'Live Story', slug: 'p7-live-story', excerpt: 'e', content: '<p>c</p>', coverImage: '',
        categoryId: category.id, authorId: users.reporter.id, status: 'PUBLISHED' },
    });
    const earlyPurge = await makeRequest(baseUrl, 'POST', `/api/articles/${live.id}/purge`, undefined, users.purger.token);
    T.eq(earlyPurge.status, 409, 'purge blocked while story is still live');
    T.ok(fx.readArticle(live.id), 'live story NOT removed');

    // ── slug change → UrlRedirect + 301 ──
    const slugged = await db.article.create({
      data: { title: 'Slug Mover', slug: 'p7-slug-original', excerpt: 'e', content: '<p>c</p>', coverImage: '',
        categoryId: category.id, authorId: users.reporter.id, status: 'PUBLISHED' },
    });

    const slugRes = await makeRequest(baseUrl, 'PUT', `/api/articles/${slugged.id}`,
      { slug: 'p7-slug-renamed' }, users.editor.token);
    T.eq(slugRes.status, 200, 'slug update accepted');
    T.eq(slugRes.body.slug, 'p7-slug-renamed', 'slug actually changed');

    const redirect = db.data.urlRedirects.find((r: any) => r.sourcePath === '/article/p7-slug-original');
    T.ok(redirect, 'UrlRedirect row created for old slug');
    T.eq(redirect.destinationPath, '/article/p7-slug-renamed', 'redirect points at new path');

    const oldVisit = await makeRequest(baseUrl, 'GET', '/api/articles/p7-slug-original');
    T.eq(oldVisit.status, 301, 'old slug returns 301');
    T.eq(oldVisit.headers.get('location'), '/article/p7-slug-renamed', 'Location header carries new path');

    const newVisit = await makeRequest(baseUrl, 'GET', '/api/articles/p7-slug-renamed');
    T.eq(newVisit.status, 200, 'new slug serves the article');

    // invalid slug format rejected
    const badSlug = await makeRequest(baseUrl, 'PUT', `/api/articles/${slugged.id}`, { slug: 'Bad Slug!' }, users.editor.token);
    T.eq(badSlug.status, 400, 'invalid slug format rejected');

    // duplicate slug collision rejected with no partial write
    await db.article.create({
      data: { title: 'Slug Squatter', slug: 'p7-slug-taken', excerpt: 'e', content: '<p>c</p>', coverImage: '',
        categoryId: category.id, authorId: users.reporter.id, status: 'DRAFT' },
    });
    const takenRes = await makeRequest(baseUrl, 'PUT', `/api/articles/${slugged.id}`, { slug: 'p7-slug-taken' }, users.editor.token);
    T.eq(takenRes.status, 409, 'slug collision rejected 409');
    T.eq(fx.readArticle(slugged.id).slug, 'p7-slug-renamed', 'article slug unchanged after rejected collision');
  } finally {
    await fx.close();
  }
}
