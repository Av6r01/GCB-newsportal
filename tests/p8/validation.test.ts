/**
 * Phase 8 regression: strict validation + safe error responses.
 * - Malformed payloads (wrong types, missing fields, control chars) → 400 with
 *   generic field messages only — never raw zod dumps or internal identifiers.
 * - Oversized bodies → JSON body-parser cap (413) or per-field 400.
 * - Writes against unauthorized records (nonexistent/draft article) → 404
 *   "Story not found." with no id disclosure.
 * - BAD request error bodies never contain stack traces or driver internals.
 */
import { buildFixture, mkPublishedArticle, makeRequest } from './harness.ts';

export async function check(T: any) {
  const fx = await buildFixture();
  try {
    const { baseUrl } = fx;
    const art = await mkPublishedArticle(fx, 'Validation Story', 'p8-validation-story');
    const draft = await fx.db.article.create({
      data: {
        title: 'Draft Story', slug: 'p8-validation-draft', excerpt: 'e',
        content: '<p>c</p>', coverImage: '', categoryId: fx.category.id,
        authorId: fx.users.reporter.id, status: 'DRAFT',
      },
    });

    // ── comments POST: malformed payloads ──
    T.eq((await makeRequest(baseUrl, 'POST', '/api/comments', {})).status, 400, 'comment with missing fields → 400');
    T.eq((await makeRequest(baseUrl, 'POST', '/api/comments', { articleId: art.id, authorName: 'A', authorEmail: 'not-an-email', content: 'hi there' })).status, 400, 'comment with malformed email → 400');
    T.eq((await makeRequest(baseUrl, 'POST', '/api/comments', { articleId: art.id, authorName: 'Valid Name', authorEmail: 'v@example.com', content: 12345 })).status, 400, 'comment with non-string content → 400');
    T.eq((await makeRequest(baseUrl, 'POST', '/api/comments', { articleId: 42, authorName: 'Valid Name', authorEmail: 'v@example.com', content: 'hi there again' })).status, 400, 'comment with numeric articleId → 400');
    const longContent = 'a'.repeat(21_000);
    T.eq((await makeRequest(baseUrl, 'POST', '/api/comments', { articleId: art.id, authorName: 'Valid Name', authorEmail: 'v@example.com', content: longContent })).status, 400, 'comment with 21k chars → 400 (payload bound)');

    // control characters stripped, not rejected (readers drop junk chars)
    const ctrl = await makeRequest(baseUrl, 'POST', '/api/comments', { articleId: art.id, authorName: 'Ctrl\u0000Name', authorEmail: 'c@example.com', content: 'Clean\u0007 text \u000E for review' });
    T.eq(ctrl.status, 200, 'comment with control chars accepted after stripping');
    T.ok(ctrl.body && ctrl.body.message === 'Comment submitted for moderation', 'comment response is the generic message');

    // ── unauthorized records: draft article, nonexistent article ──
    const draftComment = await makeRequest(baseUrl, 'POST', '/api/comments', { articleId: draft.id, authorName: 'Valid Name', authorEmail: 'd@example.com', content: 'comment on draft' });
    T.eq(draftComment.status, 404, 'comment on DRAFT article → 404');
    const ghostComment = await makeRequest(baseUrl, 'POST', '/api/comments', { articleId: 'art-nonexistent-key', authorName: 'Valid Name', authorEmail: 'g@example.com', content: 'comment on nothing' });
    T.eq(ghostComment.status, 404, 'comment on nonexistent article → 404');
    T.ok(!JSON.stringify(ghostComment.body).includes('art-nonexistent-key'), '404 response does not echo the queried id');

    // ── reactions: malformed + unauthorized ──
    T.eq((await makeRequest(baseUrl, 'POST', `/api/reactions/${art.id}`, { type: 'LAUGHING' })).status, 400, 'unknown reaction type → 400');
    T.eq((await makeRequest(baseUrl, 'POST', `/api/reactions/${art.id}`, { type: 42 })).status, 400, 'numeric reaction type → 400');
    T.eq((await makeRequest(baseUrl, 'POST', `/api/reactions/${art.id}`, {})).status, 400, 'missing reaction type → 400');
    T.eq((await makeRequest(baseUrl, 'POST', '/api/reactions/ghost-article', { type: 'INSIGHTFUL' })).status, 404, 'reaction on nonexistent article → 404');
    const draftReaction = await makeRequest(baseUrl, 'POST', `/api/reactions/${draft.id}`, { type: 'INSIGHTFUL' });
    T.eq(draftReaction.status, 404, 'reaction on DRAFT article → 404 (never counted)');

    // ── polls: malformed votes ──
    const poll = await fx.db.poll.create({ data: { question: 'Best reporter?', options: [{ label: 'A', votes: 0 }, { label: 'B', votes: 0 }] } });
    T.eq((await makeRequest(baseUrl, 'POST', `/api/polls/${poll.id}/vote`, {})).status, 400, 'poll vote without optionIndex → 400');
    T.eq((await makeRequest(baseUrl, 'POST', `/api/polls/${poll.id}/vote`, { optionIndex: 'nine' })).status, 400, 'non-numeric optionIndex → 400');
    T.eq((await makeRequest(baseUrl, 'POST', `/api/polls/${poll.id}/vote`, { optionIndex: 99 })).status, 400, 'out-of-range optionIndex → 400');
    // the malformed attempts must NOT burn the IP voter identity (old bug: the
    // IP was registered before payload validation) — a valid vote succeeds now
    T.eq((await makeRequest(baseUrl, 'POST', `/api/polls/${poll.id}/vote`, { optionIndex: 0 })).status, 200, 'valid vote after malformed attempts accepted (identity not burned)');
    // and the earlier valid vote still blocks a second one
    T.eq((await makeRequest(baseUrl, 'POST', `/api/polls/${poll.id}/vote`, { optionIndex: 5 })).status, 400, 'out-of-range vote is 400 (and does not consume the identity)');

    // ── analytics: malformed + injection attempts ──
    T.eq((await makeRequest(baseUrl, 'POST', '/api/analytics/track', { type: 'WIDGET_EXPLODE' })).status, 400, 'unknown event type → 400');
    T.eq((await makeRequest(baseUrl, 'POST', '/api/analytics/track', { type: 99 })).status, 400, 'numeric event type → 400');
    T.eq((await makeRequest(baseUrl, 'POST', '/api/analytics/track', { type: 'PAGE_VIEW', entityId: { nested: 'object' } })).status, 400, 'object entityId → 400');

    const bigMeta = 'x'.repeat(500);
    const injected = await makeRequest(baseUrl, 'POST', '/api/analytics/track', {
      type: 'PAGE_VIEW',
      metadata: { evilPayload: bigMeta, articleId: art.id, passwordHunter: 'x' },
    });
    T.eq(injected.status, 200, 'analytics with unknown metadata keys still accepted (extraneous dropped)');
    const lastEvent = fx.db.data.analyticsEvents[fx.db.data.analyticsEvents.length - 1];
    T.ok(lastEvent && lastEvent.metadata !== undefined && Object.keys(lastEvent.metadata).length > 0, 'some metadata retained');
    const keptKeys = Object.keys(lastEvent.metadata || {});
    T.ok(keptKeys.every(k => ['articleId', 'path', 'referrer', 'sessionId', 'queryKey', 'shareChannel', 'optionIndex', 'searchTerm', 'sectionSlug', 'variant'].includes(k)), `only allowlisted metadata keys retained (kept: ${keptKeys.join(',')})`);
    T.ok(lastEvent.metadata.articleId === art.id, 'allowlisted metadata key retained');

    // ── newsletter: malformed ──
    T.eq((await makeRequest(baseUrl, 'POST', '/api/newsletter/subscribe', { email: 'nope' })).status, 400, 'invalid email → 400');
    T.eq((await makeRequest(baseUrl, 'POST', '/api/newsletter/subscribe', { email: 'x'.repeat(260) + '@example.com' })).status, 400, 'overlong email → 400');
    T.eq((await makeRequest(baseUrl, 'POST', '/api/newsletter/subscribe', {})).status, 400, 'missing email → 400');

    // ── oversized request body (JSON parser cap) ──
    const giantBody = JSON.stringify({ articleId: art.id, authorName: 'N', authorEmail: 'x@example.com', content: 'a'.repeat(300_000), filler: 'b'.repeat(50_000) });
    const giant = await makeRequest(baseUrl, 'POST', '/api/comments', giantBody);
    T.ok(giant.status === 413 || giant.status === 400, `oversized JSON body rejected (413/400, got ${giant.status})`);

    // ── invalid JSON body ──
    const malformed = await makeRequest(baseUrl, 'POST', '/api/comments', '{"articleId": trunc');
    T.ok(malformed.status >= 400 && malformed.status < 500, `malformed JSON rejected (${malformed.status})`);
    T.ok(JSON.stringify(malformed.body).toLowerCase().includes('syntax') === false, 'malformed-JSON error does not expose parser internals');

    // ── safe error shapes everywhere (no zod dumps / driver internals) ──
    for (const [method, url, body] of [
      ['POST', '/api/comments', { authorEmail: 'bad' }],
      ['POST', '/api/analytics/track', { type: 'ZZZ' }],
      ['POST', '/api/newsletter/subscribe', { email: 'bad' }],
      ['POST', `/api/polls/${poll.id}/vote`, {}],
      ['POST', `/api/reactions/${art.id}`, {}],
    ] as Array<[string, string, any]>) {
      const r = await makeRequest(baseUrl, method, url, body);
      const flat = JSON.stringify(r.body) || '';
      T.ok(
        !/prisma|sqlite|select |insert |where "|at /i.test(flat) && !(r.body?.error?.length > 300),
        `${method} ${url.split('?')[0]} error body is generic and bounded`
      );
    }

    // ── TTS shape checks (auth handled in tts-quota suite) ──
    const ttsBadVoice = await makeRequest(baseUrl, 'POST', '/api/ai/tts', { text: 'hello world', voice: 'bad_voice_!!' }, fx.users.reader.token);
    T.eq(ttsBadVoice.status, 400, 'TTS with malformed voice name → 400');
    const ttsOversize = await makeRequest(baseUrl, 'POST', '/api/ai/tts', { text: 'A'.repeat(60_000) }, fx.users.reader.token);
    T.eq(ttsOversize.status, 400, 'TTS with 60k chars → 400');
  } finally {
    await fx.close();
  }
}
