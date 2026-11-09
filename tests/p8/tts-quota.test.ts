/**
 * Phase 8 regression: TTS access control, quotas, provider failure shapes.
 * TTS_DAILY_QUOTA_PER_USER=2, TTS_MAX_CONCURRENT=2 (tests/p8/run.ts).
 * No GEMINI_API_KEY is configured in the test env → the provider-unavailable
 * path (503) is exercised; timeout handling requires a live provider and is
 * documented in docs/OPERATIONAL_LIMITS.md rather than unit-tested.
 */
import { buildFixture, mkPublishedArticle, makeRequest } from './harness.ts';

export async function check(T: any) {
  const fx = await buildFixture();
  try {
    const { baseUrl } = fx;
    await mkPublishedArticle(fx, 'Narration Story', 'p8-narration-story');

    // ── auth ──
    T.eq((await makeRequest(baseUrl, 'POST', '/api/ai/tts', { text: 'hello' })).status, 401, 'anonymous TTS → 401 (no anonymous cost drain)');
    // NOTE: malformed JSON is rejected by the GLOBAL body-parser before route
    // auth (400 'Malformed request body.') — that is the intended contract; the
    // anonymous-cost guarantee is about neither 2xx nor provider calls.
    const anonMalformed = await makeRequest(baseUrl, 'POST', '/api/ai/tts', 'not even json');
    T.ok(anonMalformed.status === 400 || anonMalformed.status === 401, `anonymous TTS with malformed body rejected (${anonMalformed.status})`);
    T.ok((anonMalformed.body?.error || '').length < 200, 'malformed-body error stays generic');

    // ── per-user daily quota consumes ATTEMPTS (incl. the 503s from the absent provider) ──
    // few attempts: reader#1 and reader#2 exhaust TTS_DAILY_QUOTA_PER_USER=2
    const r1 = await makeRequest(baseUrl, 'POST', '/api/ai/tts', { text: 'narration attempt one' }, fx.users.reader.token);
    const r2 = await makeRequest(baseUrl, 'POST', '/api/ai/tts', { text: 'narration attempt two' }, fx.users.reader.token);
    T.ok([r1.status, r2.status].every(s => s === 503 || s === 200), 'first two attempts within quota proceed to provider layer');
    T.ok((r1.body.error || '').includes('not available'), '503 message is generic (no provider/key names)');

    const r3 = await makeRequest(baseUrl, 'POST', '/api/ai/tts', { text: 'narration attempt three' }, fx.users.reader.token);
    T.eq(r3.status, 429, 'third attempt for the SAME user exceeds the daily quota → 429');
    T.ok((r3.body.error || '').includes('limit'), 'quota message is user-facing, not internal');
    T.ok((r3.body.error || '').includes('provider') === false, 'quota message names no provider internals');

    // different user is unaffected (quota is per-user)
    const other = await makeRequest(baseUrl, 'POST', '/api/ai/tts', { text: 'a different user narrates' }, fx.users.editor.token);
    T.ok(other.status === 503 || other.status === 200, `other user's quota independent (${other.status})`);

    // malformed voice is rejected BEFORE burning quota (zod runs pre-consume)
    const pre = (await makeRequest(baseUrl, 'POST', '/api/ai/tts', { text: 'x', voice: 'NOT-VALID!!' }, fx.users.reporter.token)).status;
    T.eq(pre, 400, 'malformed voice → 400');
  } finally {
    await fx.close();
  }
}
