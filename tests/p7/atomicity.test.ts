/**
 * Phase 7 regression: transactional updates and defined-only payloads.
 * - PUT /api/articles/:id is all-or-nothing: an unknown tag reference aborts
 *   the update BEFORE any column changes, and the audit trail stays consistent.
 * - Breaking-news PUT must never overwrite stored fields with `undefined`
 *   (the destructure-then-spread corruption class).
 */
import { buildFixture, makeRequest, BuiltFixture } from './harness.ts';

export async function check(T: any) {
  const fx: BuiltFixture = await buildFixture();
  try {
    const { db, users, baseUrl, category } = fx;

    // ── unknown tag aborts the update without side effects ──
    const art = await db.article.create({
      data: {
        title: 'Atomic Story', slug: 'p7-atomic-story', excerpt: 'original excerpt',
        content: '<p>original</p>', coverImage: '', categoryId: category.id,
        authorId: users.reporter.id, status: 'DRAFT',
      },
    });

    const before = JSON.parse(JSON.stringify(fx.readArticle(art.id)));
    const tagCount = db.data.articleTags.length;
    const mediaCount = db.data.articleMedia.length;

    const bad = await makeRequest(baseUrl, 'PUT', `/api/articles/${art.id}`,
      { title: 'CHANGED TITLE', tagIds: ['tag-does-not-exist'] }, users.editor.token);
    T.eq(bad.status, 400, 'unknown tag id rejected 400');

    const after = fx.readArticle(art.id);
    T.eq(after.title, before.title, 'title unchanged after failed update');
    T.eq(after.excerpt, before.excerpt, 'excerpt unchanged after failed update');
    T.eq(db.data.articleTags.length, tagCount, 'tag associations untouched after failed update');
    T.eq(db.data.articleMedia.length, mediaCount, 'media associations untouched after failed update');

    // ── valid partial update still works and audits once ──
    const ok = await makeRequest(baseUrl, 'PUT', `/api/articles/${art.id}`,
      { title: 'Atomic Story (edited)' }, users.editor.token);
    T.eq(ok.status, 200, 'valid partial update works');
    T.eq(fx.readArticle(art.id).title, 'Atomic Story (edited)', 'title updated');
    const updateLogs = db.data.auditLogs.filter((l: any) => l.action === 'UPDATE_ARTICLE' && l.entityId === art.id);
    T.eq(updateLogs.length, 1, 'audit written exactly once');

    // ── editorialNote: legacy `editorialNotes`(plural) key still maps ──
    const noteRes = await makeRequest(baseUrl, 'PUT', `/api/articles/${art.id}`,
      { editorialNotes: 'legacy plural field' }, users.editor.token);
    T.eq(noteRes.status, 200, 'legacy plural field accepted');
    T.eq(fx.readArticle(art.id).editorialNote, 'legacy plural field', 'editorialNotes mapped to editorialNote');

    // ── breaking-news PUT: defined-only payload ──
    const brk = await db.breakingNewsAnnouncement.create({
      data: { headline: 'Original headline', summary: 'Original summary', urgencyRank: 2, isActive: true },
    });

    // update ONLY headline — summary/urgency must survive (the old code sent
    // explicit undefined for them and the JSON spread stomped stored values)
    const brkRes = await makeRequest(baseUrl, 'PUT', `/api/breaking-news/${brk.id}`,
      { headline: 'Changed headline only' }, users.editor.token);
    T.eq(brkRes.status, 200, 'breaking-news partial update ok');
    const brkStored = db.data.breakingNewsAnnouncements.find((b: any) => b.id === brk.id);
    T.eq(brkStored.headline, 'Changed headline only', 'headline updated');
    T.eq(brkStored.summary, 'Original summary', 'summary NOT stomped by undefined');
    T.eq(brkStored.urgencyRank, 2, 'urgencyRank NOT stomped by undefined');

    // empty PUT rejected (prevents accidental full-undefined writes)
    const emptyRes = await makeRequest(baseUrl, 'PUT', `/api/breaking-news/${brk.id}`,
      {}, users.editor.token);
    T.eq(emptyRes.status, 400, 'breaking-news PUT with no fields rejected');
  } finally {
    await fx.close();
  }
}
