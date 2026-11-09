/**
 * Phase 10 — admin management endpoints walk (positive + negative paths).
 * Every endpoint added for functional completeness is exercised here against
 * the REAL server + JSON driver, including auth (401), permission (403),
 * not-found (404), duplicate (409) and validation (400) paths, plus the
 * stuck-release retry semantics and derived-notification contracts.
 */
import type { Checker } from './run-suite';
import { buildFixture, api, get, type BuiltFixture } from './harness';

export async function check(T: Checker) {
  const fx: BuiltFixture = await buildFixture();
  const { baseUrl } = fx;
  const admin = fx.users.admin.token; // ADMIN: users/ad/settings/analytics/publish
  const editor = fx.users.editor.token; // MANAGING_EDITOR: users:view, analytics:view
  const reporter = fx.users.reporter.token; // none of the above
  const reader = fx.users.reader.token;
  const advMgr = fx.users.advMgr.token; // ad:manage + analytics:view

  try {
    // ── Staff accounts ─────────────────────────────────────────────────────
    await (async () => {
      const anon = await api(baseUrl, 'GET', '/api/admin/users');
      T.eq(anon.status, 401, 'staff list: 401 unauthenticated');

      const readerRes = await api(baseUrl, 'GET', '/api/admin/users', reader);
      T.eq(readerRes.status, 403, 'staff list: 403 READER');

      const rep = await api(baseUrl, 'GET', '/api/admin/users', reporter);
      T.eq(rep.status, 403, 'staff list: 403 REPORTER (users:view missing)');

      const list = await api(baseUrl, 'GET', '/api/admin/users', admin);
      T.eq(list.status, 200, 'staff list: 200 ADMIN');
      T.ok(Array.isArray(list.json) && list.json.length >= 5, 'staff list: real users present');
      T.ok(
        Array.isArray(list.json) && list.json.every((u: any) => !('passwordHash' in u)),
        'staff list: passwordHash never leaves the server',
      );

      const created = await api(baseUrl, 'POST', '/api/admin/users', admin, {
        email: 'new.analyst@test.local', name: 'New Analyst', role: 'ANALYST', password: 'LongEnough-Pass1',
      });
      T.eq(created.status, 201, 'staff create: 201');
      T.ok(!!created.json?.id, 'staff create: real id returned');
      T.ok(!('passwordHash' in (created.json || {})), 'staff create: no hash in response');

      const dup = await api(baseUrl, 'POST', '/api/admin/users', admin, {
        email: 'new.analyst@test.local', name: 'Dup', role: 'ANALYST', password: 'LongEnough-Pass1',
      });
      T.eq(dup.status, 409, 'staff create: 409 duplicate email');

      const superAttempt = await api(baseUrl, 'POST', '/api/admin/users', admin, {
        email: 'evil@test.local', name: 'Evil', role: 'SUPER_ADMIN', password: 'LongEnough-Pass1',
      });
      T.eq(superAttempt.status, 400, 'staff create: SUPER_ADMIN role rejected by schema');

      const readerAttempt = await api(baseUrl, 'POST', '/api/admin/users', admin, {
        email: 'x@test.local', name: 'X', role: 'READER', password: 'LongEnough-Pass1',
      });
      T.eq(readerAttempt.status, 400, 'staff create: READER role rejected by schema');

      const weak = await api(baseUrl, 'POST', '/api/admin/users', admin, {
        email: 'weak@test.local', name: 'Weak', role: 'REPORTER', password: 'short',
      });
      T.eq(weak.status, 400, 'staff create: 400 weak password');

      const target = created.json;
      const roleChange = await api(baseUrl, 'PUT', `/api/admin/users/${target.id}/role`, admin, { role: 'SECTION_EDITOR' });
      T.eq(roleChange.status, 200, 'staff role change: 200 ADMIN (roles:assign)');
      T.eq(roleChange.json?.user?.role, 'SECTION_EDITOR', 'staff role change: persisted');

      const roleByReporter = await api(baseUrl, 'PUT', `/api/admin/users/${target.id}/role`, reporter, { role: 'SECTION_EDITOR' });
      T.eq(roleByReporter.status, 403, 'staff role change: 403 REPORTER');

      const statusRes = await api(baseUrl, 'PUT', `/api/admin/users/${target.id}/status`, admin, { isActive: false });
      T.eq(statusRes.status, 200, 'staff status change: 200');
      const after = await api(baseUrl, 'GET', '/api/admin/users', admin);
      const changed = (after.json || []).find((u: any) => u.id === target.id);
      T.eq(changed?.role, 'SECTION_EDITOR', 'staff status change: role untouched');
    })();

    // ── Ad slots ───────────────────────────────────────────────────────────
    let adId = '';
    let adId2 = '';
    await (async () => {
      const empty = await get(baseUrl, '/api/ads');
      T.eq(empty.status, 200, 'public ads: 200');
      T.ok(Array.isArray(empty.json) && empty.json.length === 0, 'public ads: empty inventory = empty array (no fabricated sponsors)');

      const created = await api(baseUrl, 'POST', '/api/admin/ads', admin, {
        slotName: 'Leaderboard Top', dimensions: '728x90', adCode: 'Trade Summit 2026', isActive: true,
      });
      T.eq(created.status, 201, 'ad create: 201');
      T.eq(created.json?.slotName, 'LEADERBOARD_TOP', 'ad create: slot name normalized');
      adId = created.json.id;

      const dup = await api(baseUrl, 'POST', '/api/admin/ads', advMgr, {
        slotName: 'leaderboard_top', dimensions: '300x250', adCode: '',
      });
      T.eq(dup.status, 409, 'ad create: 409 duplicate slot');

      const advCreated = await api(baseUrl, 'POST', '/api/admin/ads', advMgr, {
        slotName: 'Sidebar Rect', dimensions: '300x250', adCode: 'Sponsor B',
      });
      T.eq(advCreated.status, 201, 'ad create: ADVERTISING_MANAGER has ad:manage');
      T.eq(advCreated.json?.slotName, 'SIDEBAR_RECT', 'ad create: normalization parity for adv mgr');
      adId2 = advCreated.json.id;

      const noAuth = await api(baseUrl, 'GET', '/api/admin/ads');
      T.eq(noAuth.status, 401, 'ad admin list: 401 unauthenticated');
      const forbidden = await api(baseUrl, 'GET', '/api/admin/ads', editor);
      T.eq(forbidden.status, 403, 'ad admin list: 403 MANAGING_EDITOR (no ad:manage)');

      await api(baseUrl, 'POST', `/api/ads/${adId}/impression`);
      await api(baseUrl, 'POST', `/api/ads/${adId}/impression`);
      await api(baseUrl, 'POST', `/api/ads/${adId}/click`);
      const missing = await api(baseUrl, 'POST', '/api/ads/ad-nope/impression');
      T.eq(missing.status, 404, 'ad impression: 404 unknown slot');

      const list = await api(baseUrl, 'GET', '/api/admin/ads', admin);
      const mine = (list.json || []).find((a: any) => a.id === adId);
      T.eq(mine?.impressions, 2, 'ad metrics: impressions recorded');
      T.eq(mine?.clicks, 1, 'ad metrics: clicks recorded');

      const pub = await get(baseUrl, '/api/ads');
      T.eq(pub.json?.length, 2, 'public ads: both active slots exposed');

      // Deactivate flow: single delete archives, repeat delete purges
      const deact = await api(baseUrl, 'DELETE', `/api/admin/ads/${adId2}`, advMgr);
      T.eq(deact.status, 200, 'ad delete: first delete archives (200)');
      T.eq(deact.json?.archived, true, 'ad delete: response marks archived');
      const afterDeact = await get(baseUrl, '/api/ads');
      T.eq(afterDeact.json?.length, 1, 'public ads: deactivated slot hidden');
      const purged = await api(baseUrl, 'DELETE', `/api/admin/ads/${adId2}`, advMgr);
      T.eq(purged.status, 200, 'ad delete: repeat delete purges (200)');

      const badDimensions = await api(baseUrl, 'POST', '/api/admin/ads', admin, {
        slotName: 'Bad', dimensions: 'wide', adCode: '',
      });
      T.eq(badDimensions.status, 400, 'ad create: 400 malformed dimensions');
    })();

    // ── Newsletter subscriber management + unsubscribe ─────────────────────
    let subId = '';
    const subEmail = 'reader10@test.example';
    await (async () => {
      const sub = await api(baseUrl, 'POST', '/api/newsletter/subscribe', undefined, { email: subEmail });
      T.eq(sub.status, 200, 'newsletter public subscribe: 200');

      const noAuth = await api(baseUrl, 'GET', '/api/admin/newsletter/subscribers');
      T.eq(noAuth.status, 401, 'subscriber list: 401 unauthenticated');
      const forbidden = await api(baseUrl, 'GET', '/api/admin/newsletter/subscribers', reporter);
      T.eq(forbidden.status, 403, 'subscriber list: 403 REPORTER');

      const list = await api(baseUrl, 'GET', '/api/admin/newsletter/subscribers', editor);
      T.eq(list.status, 200, 'subscriber list: 200 MANAGING_EDITOR (users:view)');
      const found = (list.json || []).find((s: any) => s.email === subEmail);
      T.ok(!!found, 'subscriber list: real subscription present');
      subId = found.id;

      const removeForbidden = await api(baseUrl, 'DELETE', `/api/admin/newsletter/subscribers/${subId}`, editor);
      T.eq(removeForbidden.status, 403, 'subscriber removal: 403 MANAGING_EDITOR (needs users:manage)');
      const removed = await api(baseUrl, 'DELETE', `/api/admin/newsletter/subscribers/${subId}`, admin);
      T.eq(removed.status, 200, 'subscriber removal: 200 ADMIN');
      const missing = await api(baseUrl, 'DELETE', `/api/admin/newsletter/subscribers/${subId}`, admin);
      T.eq(missing.status, 404, 'subscriber removal: 404 repeat');

      const unsub = await api(baseUrl, 'POST', '/api/newsletter/unsubscribe', undefined, { email: 'never-subscribed@test.example' });
      T.eq(unsub.status, 200, 'public unsubscribe: 200 even for unknown address (no enumeration)');
      T.eq(unsub.json?.success, true, 'public unsubscribe: generic success');

      const badEmail = await api(baseUrl, 'POST', '/api/newsletter/unsubscribe', undefined, { email: 'not-an-email' });
      T.eq(badEmail.status, 400, 'public unsubscribe: 400 malformed address');
    })();

    // ── Analytics report ───────────────────────────────────────────────────
    await (async () => {
      const noAuth = await api(baseUrl, 'GET', '/api/admin/analytics/report?window=7d');
      T.eq(noAuth.status, 401, 'analytics report: 401 unauthenticated');
      const forbidden = await api(baseUrl, 'GET', '/api/admin/analytics/report', reader);
      T.eq(forbidden.status, 403, 'analytics report: 403 READER');

      // Seed real events via the public track endpoint (taxonomy-validated)
      const track = await api(baseUrl, 'POST', '/api/analytics/track', undefined, {
        type: 'PAGE_VIEW', entityId: 'home',
      });
      T.ok(track.status === 200 || track.status === 201, `analytics track seeded event (${track.status})`);

      for (const w of ['24h', '7d', '30d', '90d']) {
        const rep = await api(baseUrl, 'GET', `/api/admin/analytics/report?window=${w}`, advMgr);
        T.eq(rep.status, 200, `analytics report: 200 window ${w}`);
        T.eq(typeof rep.json?.total, 'number', `analytics report: total is numeric (${w})`);
        T.ok(Array.isArray(rep.json?.byDay), `analytics report: byDay array (${w})`);
      }

      const bogus = await api(baseUrl, 'GET', '/api/admin/analytics/report?window=13m', advMgr);
      T.eq(bogus.status, 400, 'analytics report: 400 unknown window');
      const def = await api(baseUrl, 'GET', '/api/admin/analytics/report', advMgr);
      T.eq(def.json?.window, '7d', 'analytics report: default window 7d');
    })();

    // ── Site settings ──────────────────────────────────────────────────────
    await (async () => {
      const pub = await get(baseUrl, '/api/settings');
      T.eq(pub.status, 200, 'public settings: 200');
      T.ok(pub.json && Object.keys(pub.json).length === 0, 'public settings: empty until configured (never fabricated)');

      const noAuth = await api(baseUrl, 'GET', '/api/admin/settings');
      T.eq(noAuth.status, 401, 'admin settings: 401 unauthenticated');
      const forbidden = await api(baseUrl, 'GET', '/api/admin/settings', editor);
      T.eq(forbidden.status, 403, 'admin settings: 403 MANAGING_EDITOR (needs settings:manage)');

      const list = await api(baseUrl, 'GET', '/api/admin/settings', admin);
      T.eq(list.status, 200, 'admin settings: 200');
      T.ok(Array.isArray(list.json?.allowedKeys) && list.json.allowedKeys.length > 0, 'admin settings: allowedKeys contract');

      const put = await api(baseUrl, 'PUT', '/api/admin/settings', admin, {
        settings: [
          { key: 'defaultLanguage', value: 'bn' },
          { key: 'siteTitle', value: 'Global Chronicle Newsroom' },
          { key: 'newsletterEnabled', value: true },
        ],
      });
      T.eq(put.status, 200, 'settings update: 200');

      const pubAfter = await get(baseUrl, '/api/settings');
      T.eq(pubAfter.json?.defaultLanguage, 'bn', 'public settings: defaultLanguage propagates');
      T.eq(pubAfter.json?.siteTitle, 'Global Chronicle Newsroom', 'public settings: siteTitle propagates');
      T.ok(!('contactEmail' in (pubAfter.json || {})), 'public settings: admin-only keys never leak');

      const badLang = await api(baseUrl, 'PUT', '/api/admin/settings', admin, {
        settings: [{ key: 'defaultLanguage', value: 'fr' }],
      });
      T.eq(badLang.status, 400, 'settings update: 400 invalid language');

      const badBool = await api(baseUrl, 'PUT', '/api/admin/settings', admin, {
        settings: [{ key: 'newsletterEnabled', value: 'yes' }],
      });
      T.eq(badBadBoolStatus(badBool.status), true, 'settings update: non-boolean for boolean key rejected');
      const badKey = await api(baseUrl, 'PUT', '/api/admin/settings', admin, {
        settings: [{ key: 'smtp_password', value: 'hunter2' }],
      });
      T.eq(badKey.status, 400, 'settings update: 400 key outside allowlist');
      const empty = await api(baseUrl, 'PUT', '/api/admin/settings', admin, { settings: [] });
      T.eq(empty.status, 400, 'settings update: 400 empty batch');
    })();

    // ── Redirect management ────────────────────────────────────────────────
    let redirectId = '';
    await (async () => {
      const noAuth = await api(baseUrl, 'GET', '/api/admin/redirects');
      T.eq(noAuth.status, 401, 'redirect list: 401 unauthenticated');
      const forbidden = await api(baseUrl, 'GET', '/api/admin/redirects', editor);
      T.eq(forbidden.status, 403, 'redirect list: 403 MANAGING_EDITOR (needs settings:manage)');

      const created = await api(baseUrl, 'POST', '/api/admin/redirects', admin, {
        sourcePath: '/article/old-slug', destinationPath: '/article/new-slug', statusCode: 301,
      });
      T.eq(created.status, 201, 'redirect create: 201');
      redirectId = created.json?.id;

      const dup = await api(baseUrl, 'POST', '/api/admin/redirects', admin, {
        sourcePath: '/article/old-slug', destinationPath: '/article/other',
      });
      T.eq(dup.status, 409, 'redirect create: 409 duplicate source');
      const self = await api(baseUrl, 'POST', '/api/admin/redirects', admin, {
        sourcePath: '/loop', destinationPath: '/loop',
      });
      T.eq(self.status, 400, 'redirect create: 400 self-pointing');
      const badPath = await api(baseUrl, 'POST', '/api/admin/redirects', admin, {
        sourcePath: 'no-slash', destinationPath: '/article/ok',
      });
      T.eq(badPath.status, 400, 'redirect create: 400 source must start with /');

      // The page-level 301 actually fires (SEO middleware reads this table)
      const pageRes = await get(baseUrl, '/article/old-slug');
      T.eq(pageRes.status, 301, 'redirect: page-level 301 for retired article path');
      T.eq(pageRes.location, '/article/new-slug', 'redirect: page location header correct');

      const deact = await api(baseUrl, 'PUT', `/api/admin/redirects/${redirectId}`, admin, { isActive: false });
      T.eq(deact.status, 200, 'redirect update: 200');
      const off = await get(baseUrl, '/article/old-slug');
      T.eq(off.status, 404, 'redirect: deactivated rule no longer redirects');
      const act = await api(baseUrl, 'PUT', `/api/admin/redirects/${redirectId}`, admin, { isActive: true });
      T.eq(act.status, 200, 'redirect update: re-activated');

      const gone = await api(baseUrl, 'DELETE', `/api/admin/redirects/${redirectId}`, admin);
      T.eq(gone.status, 200, 'redirect delete: 200');
      const again = await api(baseUrl, 'DELETE', `/api/admin/redirects/${redirectId}`, admin);
      T.eq(again.status, 404, 'redirect delete: 404 repeat');
    })();

    // ── Notifications derived from real events ────────────────────────────
    await (async () => {
      const noAuth = await api(baseUrl, 'GET', '/api/admin/notifications');
      T.eq(noAuth.status, 401, 'notifications: 401 unauthenticated');
      const forbidden = await api(baseUrl, 'GET', '/api/admin/notifications', reader);
      T.eq(forbidden.status, 403, 'notifications: 403 READER');

      // Seed REAL backlog: one IN_REVIEW dispatch, one pending comment
      await fx.db.article.create({
        data: {
          title: 'P10 review dispatch', slug: 'p10-review-dispatch',
          excerpt: 'e', content: '<p>c</p>', categoryId: fx.category.id,
          authorId: fx.users.reporter.id, status: 'IN_REVIEW',
        },
      });
      await fx.db.comment.create({ data: { articleId: (await fx.db.article.findUnique({ where: { slug: 'p10-review-dispatch' } }))?.id, authorName: 'Reader', content: 'Pending comment body', status: 'PENDING' } });

      const items = await api(baseUrl, 'GET', '/api/admin/notifications', editor);
      T.eq(items.status, 200, 'notifications: 200 with analytics:view');
      const ids = (items.json || []).map((n: any) => n.id);
      T.ok(ids.includes('notif-review'), 'notifications: derived review item present (real IN_REVIEW backlog)');
      T.ok(ids.includes('notif-comments'), 'notifications: derived comments item present (real PENDING count)');
      const review = (items.json || []).find((n: any) => n.id === 'notif-review');
      T.ok(review?.description?.includes('1'), 'notifications: review description counts the single real dispatch');
      T.ok((items.json || []).every((n: any) => n.targetView), 'notifications: every item carries a navigation targetView');
    })();

    // ── Scheduler jobs monitoring + safe retry ────────────────────────────
    await (async () => {
      const noAuth = await api(baseUrl, 'GET', '/api/admin/scheduler/jobs');
      T.eq(noAuth.status, 401, 'scheduler jobs: 401 unauthenticated');
      const forbidden = await api(baseUrl, 'GET', '/api/admin/scheduler/jobs', reader);
      T.eq(forbidden.status, 403, 'scheduler jobs: 403 READER');

      const jobs = await api(baseUrl, 'GET', '/api/admin/scheduler/jobs', editor);
      T.eq(jobs.status, 200, 'scheduler jobs: 200 ANAYLTICS-viewer');
      T.ok(jobs.json?.daemon && typeof jobs.json.daemon.status === 'string', 'scheduler jobs: daemon status contract');
      T.ok(Array.isArray(jobs.json?.jobs), 'scheduler jobs: schedule-row list');
      T.ok(Array.isArray(jobs.json?.stuck), 'scheduler jobs: stuck list');

      const missing = await api(baseUrl, 'POST', '/api/admin/scheduler/jobs/art-ghost/retry', admin, {});
      T.eq(missing.status, 404, 'scheduler retry: 404 unknown article');

      // Published article → honest 409 (nothing to retry)
      const pubArt: any = await fx.db.article.create({
        data: {
          title: 'P10 already live', slug: 'p10-already-live', excerpt: 'e', content: '<p>c</p>',
          categoryId: fx.category.id, authorId: fx.users.reporter.id, status: 'PUBLISHED',
          publishedAt: new Date().toISOString(),
        },
      });
      const already = await api(baseUrl, 'POST', `/api/admin/scheduler/jobs/${pubArt.id}/retry`, admin, {});
      T.eq(already.status, 409, 'scheduler retry: 409 published article');
      const msgOrErr = already.json?.message || already.json?.error || '';
      T.ok(msgOrErr.includes('not SCHEDULED'), 'scheduler retry: 409 message is explicit');

      // Stuck SCHEDULED release (overdue > 2 min) — allowed by canPublish roles
      const scheduled: any = await fx.db.article.create({
        data: {
          title: 'P10 stuck release', slug: 'p10-stuck-release', excerpt: 'e', content: '<p>c</p>',
          categoryId: fx.category.id, authorId: fx.users.reporter.id, status: 'SCHEDULED',
          scheduledFor: new Date(Date.now() - 10 * 60_000).toISOString(),
        },
      });

      const stuck = await api(baseUrl, 'GET', '/api/admin/scheduler/jobs', editor);
      const stuckEntries = (stuck.json?.stuck || []).filter((s: any) => s.articleId === scheduled.id);
      T.eq(stuckEntries.length, 1, 'scheduler monitor: overdue article reported stuck (>2 min)');
      T.ok(stuckEntries[0]?.overdueMinutes >= 10, 'scheduler monitor: overdue minutes reported');

      const retryForbidden = await api(baseUrl, 'POST', `/api/admin/scheduler/jobs/${scheduled.id}/retry`, reader, {});
      T.eq(retryForbidden.status, 403, 'scheduler retry: 403 READER');

      const retry = await api(baseUrl, 'POST', `/api/admin/scheduler/jobs/${scheduled.id}/retry`, advMgr, {});
      T.eq(retry.status, 403, 'scheduler retry: 403 ADVERTISING_MANAGER (no article:publish)');

      const retried = await api(baseUrl, 'POST', `/api/admin/scheduler/jobs/${scheduled.id}/retry`, editor, {});
      T.eq(retried.status, 200, 'scheduler retry: 200 MANAGING_EDITOR (article:publish)');
      T.eq(retried.json?.executed, true, 'scheduler retry: atomic operation executed');
      T.eq(retried.json?.article?.status, 'PUBLISHED', 'scheduler retry: article now PUBLISHED');

      const after = await api(baseUrl, 'GET', '/api/admin/scheduler/jobs', editor);
      const row = (after.json?.jobs || []).find((j: any) => j.articleId === scheduled.id);
      T.ok(row && row.status === 'EXECUTED', 'scheduler retry: EXECUTED schedule row recorded');
      T.ok((after.json?.stuck || []).length === 0, 'scheduler retry: stuck list now empty');

      const repeat = await api(baseUrl, 'POST', `/api/admin/scheduler/jobs/${scheduled.id}/retry`, editor, {});
      T.eq(repeat.status, 409, 'scheduler retry: repeat retry refused (already published)');
    })();

    // ── Owned policy pages (footer links resolve to real server pages) ────
    await (async () => {
      for (const slug of ['about', 'standards', 'privacy', 'terms', 'contact']) {
        const page = await get(baseUrl, `/page/${slug}`);
        T.eq(page.status, 200, `owned page /page/${slug}: 200`);
      }
      const missing = await get(baseUrl, '/page/does-not-exist');
      T.eq(missing.status, 404, `owned page unknown slug: 404`);
    })();
  } finally {
    await fx.close();
  }
}

function badBadBoolStatus(status: number): boolean {
  return status === 400;
}
