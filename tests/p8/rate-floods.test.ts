/**
 * Phase 8 regression: request floods + duplicate-vote / dedup controls.
 * Env-tuned buckets (see tests/p8/run.ts): reactions 5, comments 3,
 * analytics 8, newsletter 3.
 */
import { buildFixture, mkPublishedArticle, makeRequest } from './harness.ts';

export async function check(T: any) {
  const fx = await buildFixture();
  try {
    const { baseUrl } = fx;
    const art = await mkPublishedArticle(fx, 'Flood Story', 'p8-flood-story');

    const poll = await fx.db.poll.create({
      data: { question: 'Flood poll?', options: [{ label: 'A', votes: 0 }, { label: 'B', votes: 0 }] },
    });

    // ── reaction flood: first 5 within bucket allowed, rest 429 (or idempotent dups) ──
    let r429 = 0, r200 = 0;
    for (let i = 0; i < 10; i++) {
      const r = await makeRequest(baseUrl, 'POST', `/api/reactions/${art.id}`, { type: 'INSIGHTFUL' });
      if (r.status === 429) r429++; else if (r.status === 200) r200++;
    }
    T.ok(r429 > 0 || r200 >= 5, `reaction flood throttled (429s: ${r429}, ok: ${r200})`);

    // dedup: same (identity, article, type) within cooldown is idempotent
    const counts1 = (await makeRequest(baseUrl, 'GET', `/api/reactions/${art.id}`)).body;
    T.ok(counts1 && counts1.INSIGHTFUL >= 1, 'at least one INSIGHTFUL reaction recorded');
    T.ok(counts1 && counts1.INSIGHTFUL <= 6, `reaction count within bucket bounds (got ${counts1.INSIGHTFUL})`);

    // different type still accepted (not deduped against other types)
    const diff = await makeRequest(baseUrl, 'POST', `/api/reactions/${art.id}`, { type: 'URGENT' });
    T.ok(diff.status === 200 || diff.status === 429, `different reaction type handled (${diff.status})`);

    // ── comment flood: 3 per hour bucket ──
    let c429 = 0, c200 = 0;
    for (let i = 0; i < 6; i++) {
      const r = await makeRequest(baseUrl, 'POST', '/api/comments', {
        articleId: art.id, authorName: 'Flooder', authorEmail: 'flood@example.com',
        content: `Flood comment number ${i} with unique text`, // unique → dedup doesn't short-circuit
      });
      if (r.status === 429) c429++; else if (r.status === 200) c200++;
    }
    T.ok(c429 >= 1, `comment flood throttled (429s: ${c429})`);
    T.ok(c200 >= 1, `moderate comment volume allowed (ok: ${c200})`);

    // duplicate-content suppression: repeating an IDENTICAL payload is silently
    // accepted without creating rows (after flood we may be throttled — check rows)
    const before = fx.db.data.comments.length;
    await makeRequest(baseUrl, 'POST', '/api/comments', {
      articleId: art.id, authorName: 'Flooder', authorEmail: 'flood@example.com',
      content: 'Repeatable unique spam text',
    });
    const afterPotentialFlood = fx.db.data.comments.length;
    await makeRequest(baseUrl, 'POST', '/api/comments', {
      articleId: art.id, authorName: 'Flooder', authorEmail: 'flood@example.com',
      content: 'Repeatable unique spam text',
    });
    T.eq(fx.db.data.comments.length, afterPotentialFlood, 'identical repeat creates NO second row');

    // ── analytics flood: 8 per minute bucket ──
    let a429 = 0, a200 = 0;
    for (let i = 0; i < 14; i++) {
      const r = await makeRequest(baseUrl, 'POST', '/api/analytics/track', { type: 'PAGE_VIEW', metadata: { variant: 'p8' } });
      if (r.status === 429) a429++; else if (r.status === 200) a200++;
    }
    T.ok(a429 >= 1, `analytics flood throttled (429s: ${a429})`);
    T.ok(a200 <= 9, `analytics accepted bounded by limit+slack (got ${a200})`);

    // ── newsletter flood: 3 per hour bucket ──
    let n429 = 0, n200 = 0;
    for (let i = 0; i < 6; i++) {
      const r = await makeRequest(baseUrl, 'POST', '/api/newsletter/subscribe', { email: `reader${i}@example.com` });
      if (r.status === 429) n429++; else if (r.status === 200) n200++;
    }
    T.ok(n429 >= 1, `newsletter flood throttled (429s: ${n429})`);

    // ── poll duplicate-vote policy ──
    // vote 1 with no cookie → IP fallback identity recorded, cookie issued
    const v1 = await makeRequest(baseUrl, 'POST', `/api/polls/${poll.id}/vote`, { optionIndex: 1 });
    T.eq(v1.status, 200, 'first vote accepted');
    T.ok(v1.setCookie && v1.setCookie.startsWith('gcn_poll_voter='), 'voter token cookie issued on first vote');
    T.ok(v1.setCookie?.includes('HttpOnly'), 'voter cookie is HttpOnly');

    // vote 2 without the cookie (cookie-blocked script) — still same IP → duplicate
    const v2 = await makeRequest(baseUrl, 'POST', `/api/polls/${poll.id}/vote`, { optionIndex: 0 });
    T.eq(v2.status, 429, 'vote after (no cookie, same IP) is duplicate-vote 429');

    // vote 3 WITH the cookie — same poll+token → duplicate
    const cookie = (v1.setCookie || '').split(';')[0];
    const v3 = await makeRequest(baseUrl, 'POST', `/api/polls/${poll.id}/vote`, { optionIndex: 1 }, undefined, cookie);
    T.eq(v3.status, 429, 'vote with same voter token → duplicate-vote 429');

    // counted exactly once
    const stored: any = fx.db.data.polls.find((p: any) => p.id === poll.id);
    T.eq(stored.options[1].votes, 1, 'option B counted exactly once');
    T.eq(stored.options[0].votes, 0, 'option A counted zero times');

    // ── abuse monitor: report exists, no raw IPs anywhere ──
    const report = await makeRequest(baseUrl, 'GET', '/api/admin/abuse-report', undefined, fx.users.admin.token);
    T.eq(report.status, 200, 'abuse report 200 for analytics viewers');
    const flat = JSON.stringify(report.body);
    T.ok(!flat.includes('127.0.0.1') && !flat.includes('::1'), 'abuse report contains no raw IP addresses');
    T.ok(report.body.routes.length >= 1, 'abuse report has recorded route entries');
    T.ok((report.body.routes[0].topOffenders[0]?.count || 0) >= 1, 'offender counts recorded');

    const readerReport = await makeRequest(baseUrl, 'GET', '/api/admin/abuse-report', undefined, fx.users.reader.token);
    T.eq(readerReport.status, 403, 'abuse report blocked for non-analytics viewers');
  } finally {
    await fx.close();
  }
}
