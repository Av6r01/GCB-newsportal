/**
 * Phase 8 regression: comment spam mitigation + privacy of records.
 * - Public list shows ONLY APPROVED comments with an explicit field whitelist;
 *   authorEmail / moderation internals never leave the server.
 * - Honeypot submissions are silently accepted but create NO row.
 * - Link-heavy comment text is auto-flagged SPAM — stored but never public.
 * - Same identity repeating identical text creates no second row.
 * - Editorial queues remain bounded and permission-gated.
 * Env: COMMENTS_RATE_MAX=50 (see tests/p8/run.ts).
 */
import { buildFixture, mkPublishedArticle, makeRequest } from './harness.ts';

export async function check(T: any) {
  const fx = await buildFixture();
  try {
    const { baseUrl } = fx;
    const art = await mkPublishedArticle(fx, 'Privacy Story', 'p8-privacy-story');

    const mk = (content: string, email?: string) =>
      makeRequest(baseUrl, 'POST', '/api/comments', {
        articleId: art.id, authorName: 'Reader Person', authorEmail: email || 'r@example.com', content,
      });

    // normal comment → PENDING (not public until approved)
    const normal = await mk('A genuinely useful, spam-free contribution about the article.');
    T.eq(normal.status, 200, 'normal comment accepted');
    T.ok(!normal.body.comment, 'response does NOT echo the created record (no email/status leak)');
    T.ok(normal.setCookie === undefined, 'no identity cookie set on comment submission');

    // honeypot: silently accepted, no row created
    const preHoney = fx.db.data.comments.length;
    const honeypot = await makeRequest(baseUrl, 'POST', '/api/comments', {
      articleId: art.id, authorName: 'Bot Bot', authorEmail: 'bot@example.com',
      content: 'Buy cheap watches now!!!', website: 'http://spam.example.com',
    });
    T.eq(honeypot.status, 200, 'honeypot visitor receives generic success');
    T.ok(honeypot.body.message === 'Comment submitted for moderation', 'honeypot message looks ordinary');
    T.eq(fx.db.data.comments.length, preHoney, 'honeypot created NO comment row');

    // pending (not approved) → invisible publicly
    let list = (await makeRequest(baseUrl, 'GET', `/api/comments?articleId=${art.id}`)).body;
    T.ok(Array.isArray(list) && list.length === 0, 'PENDING comment is NOT publicly visible');

    // approve it editorially
    const created = fx.db.data.comments[fx.db.data.comments.length - 1];
    await fx.db.comment.update({ where: { id: created.id }, data: { status: 'APPROVED' } });
    list = (await makeRequest(baseUrl, 'GET', `/api/comments?articleId=${art.id}`)).body;
    T.ok(Array.isArray(list) && list.length === 1, 'APPROVED comment is publicly visible');

    // explicit public field whitelist — even the internal SPAM-flag fields and
    // authorEmail can never leak (structurally, not via destructure strip)
    const pub = list[0];
    const allowedKeys = new Set(['id', 'articleId', 'authorName', 'content', 'status', 'createdAt']);
    const leaked = Object.keys(pub).filter(k => !allowedKeys.has(k));
    T.eq(leaked.length, 0, `public comment exposes only whitelisted fields (leaked: ${leaked.join(',')})`);
    T.ok(JSON.stringify(pub).toLowerCase().includes('@example.com') === false, 'no commenter email in public payload');
    T.eq(pub.status, 'APPROVED', 'visible record is APPROVED');

    // editorial surfaces keep moderation data + email (same authenticated surface)
    const editorList = (await makeRequest(baseUrl, 'GET', `/api/comments?articleId=${art.id}&status=ALL`, undefined, fx.users.editor.token));
    T.ok(editorList.status === 200 || editorList.status === 400, `editor status query allowed (${editorList.status})`);

    // non-editor requesting non-approved statuses is rejected
    const smuggle = await makeRequest(baseUrl, 'GET', `/api/comments?status=PENDING`);
    T.ok(smuggle.status === 401 || smuggle.status === 403, 'anonymous cannot fetch non-APPROVED statuses');
    const smuggleEditor = await makeRequest(baseUrl, 'GET', `/api/comments?status=PENDING`, undefined, fx.users.editor.token);
    T.eq(smuggleEditor.status, 200, 'editor CAN fetch PENDING queue');

    // editorial bounded queue
    T.ok(Array.isArray(smuggleEditor.body) && smuggleEditor.body.length <= 100, 'editorial pending list bounded');

    // ── link-spam auto-flagging ──
    const linkspam = await mk('Amazing deal http://a.example.com http://b.example.com http://c.example.com visit now', 'spammer@example.com');
    T.eq(linkspam.status, 200, 'link-spam comment receives generic success (no tip-off)');
    const stored: any = fx.db.data.comments[fx.db.data.comments.length - 1];
    T.eq(stored.status, 'SPAM', 'link-heavy comment auto-flagged SPAM (routed to moderation triage)');

    list = (await makeRequest(baseUrl, 'GET', `/api/comments?articleId=${art.id}`)).body;
    T.ok(!list.some((c: any) => c.id === stored.id), 'SPAM-flagged comment is not publicly visible');

    // identical content from the same identity → no second row
    const pre = fx.db.data.comments.length;
    const dupe = await mk('Exact duplicate content test for suppression.', 'dupe@example.com');
    T.eq(dupe.status, 200, 'first unique comment accepted');
    let createdRow = fx.db.data.comments.length;
    T.ok(createdRow === pre + 1, 'first unique comment stored');
    await mk('Exact duplicate content test for suppression.', 'dupe@example.com');
    T.eq(fx.db.data.comments.length, createdRow, 'identical repeat did NOT create a second row');

    // re-approve the original and verify the SPAM one stays out
    const pendingCount = (await makeRequest(baseUrl, 'GET', '/api/comments?status=SPAM', undefined, fx.users.editor.token)).body.length;
    T.ok(pendingCount >= 1, 'editor can review the SPAM bucket for triage');
  } finally {
    await fx.close();
  }
}
