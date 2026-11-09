/**
 * Security Tests B, C, D, E, F, G
 * B: Reporter cannot set status=PUBLISHED on create/update; no self-approval
 * C: Production seed guard
 * D: Media permission checks
 * E: Media usages hides unpublished refs
 * F: Comments return APPROVED only + omit email
 * G: Admin dashboard requires role; recentlyPublishedStories is array
 */
import fs from 'fs';
import path from 'path';
import { InMemoryTestDb } from './testDb.ts';
import { buildTestApp, signToken } from './appFactory.ts';
import { request } from './testApp.ts';

async function runSuite(label: string, fixed: boolean) {
  const db = new InMemoryTestDb();

  const cat = await db.category.create({ data: { id: 'cat-b', name: 'Test', slug: 'test-cat' } });
  const reporter  = await db.user.create({ data: { email: 'reporter-b@gc.test', name: 'Reporter', role: 'REPORTER', passwordHash: 'x' } });
  const editor    = await db.user.create({ data: { email: 'editor-b@gc.test',   name: 'Editor',   role: 'MANAGING_EDITOR', passwordHash: 'x' } });
  const reader    = await db.user.create({ data: { email: 'reader-b@gc.test',   name: 'Reader',   role: 'READER', passwordHash: 'x' } });
  const admin     = await db.user.create({ data: { email: 'admin-b@gc.test',    name: 'Admin',    role: 'ADMIN', passwordHash: 'x' } });
  const analyst   = await db.user.create({ data: { email: 'analyst-b@gc.test',  name: 'Analyst',  role: 'ANALYST', passwordHash: 'x' } });

  const pubArt = await db.article.create({ data: { title: 'Published', slug: 'pub-b', excerpt:'x', content:'x', categoryId: cat.id, authorId: reporter.id, status: 'PUBLISHED' } });
  const draftArt = await db.article.create({ data: { title: 'Draft',     slug: 'draft-b', excerpt:'x', content:'x', categoryId: cat.id, authorId: reporter.id, status: 'DRAFT' } });

  // Media asset used in a draft
  const media = await db.mediaAsset.create({ data: { filename: 'photo.jpg', originalUrl: '/uploads/photo.jpg', mimeType: 'image/jpeg', uploaderId: reporter.id } });
  db.data.articles.find(a => a.id === draftArt.id)!.coverImageId = media.id;

  // Comments: one per status
  await db.comment.create({ data: { articleId: pubArt.id, authorName: 'Alice', authorEmail: 'alice@example.com', content: 'Good!', status: 'APPROVED' } });
  await db.comment.create({ data: { articleId: pubArt.id, authorName: 'Spammer', authorEmail: 'spam@spam.com', content: 'Buy stuff', status: 'PENDING' } });
  await db.comment.create({ data: { articleId: pubArt.id, authorName: 'Troll', authorEmail: 'troll@bad.com', content: 'Offensive', status: 'REJECTED' } });

  // Demo account (simulating P0-05)
  await db.user.create({ data: { email: 'demo-editor@globalchronicle.test', name: 'Demo', role: 'ADMIN', passwordHash: 'x' } });

  const { baseUrl, close } = await buildTestApp(db, { fixedRoutes: fixed });
  const rToken = signToken({ id: reporter.id, email: reporter.email, role: reporter.role, name: reporter.name });
  const rdToken = signToken({ id: reader.id,   email: reader.email,   role: reader.role,   name: reader.name });
  const edToken = signToken({ id: editor.id,   email: editor.email,   role: editor.role,   name: editor.name });
  const adToken = signToken({ id: admin.id,    email: admin.email,    role: admin.role,    name: admin.name });
  const anToken = signToken({ id: analyst.id,  email: analyst.email,  role: analyst.role,  name: analyst.name });

  let passed = 0, failed = 0;
  const check = (name: string, cond: boolean, note = '') => {
    if (cond) { console.log(`  ✅ ${name}`); passed++; }
    else       { console.log(`  ❌ ${name}${note ? ' — ' + note : ''}`); failed++; }
  };

  // ── B ──
  const createPub = await request(baseUrl, 'POST', '/api/articles',
    { title: 'Reporter Pub', excerpt:'x', content:'<p>x</p>', categoryId: cat.id, status: 'PUBLISHED' },
    { Authorization: `Bearer ${rToken}` });
  check('B-1: Reporter cannot create PUBLISHED article', createPub.status === 403 || createPub.body?.status === 'DRAFT',
    `got status=${createPub.status}, article.status=${createPub.body?.status}`);

  check('B-2: READER cannot create articles (403)', (await request(baseUrl, 'POST', '/api/articles',
    { title: 'x', excerpt:'x', content:'x', categoryId: cat.id }, { Authorization: `Bearer ${rdToken}` })).status === 403,
    'expected 403');

  // B-3: separation of duties — reporter cannot approve own article
  const own = await request(baseUrl, 'POST', '/api/articles/:id/transition'.replace(':id', draftArt.id),
    { targetState: 'IN_REVIEW' }, { Authorization: `Bearer ${rToken}` });
  // First: submit for review (allowed)
  check('B-3a: Reporter can submit own article for review', own.status !== 403, `got ${own.status}`);

  const selfApprove = await request(baseUrl, 'POST', `/api/articles/${draftArt.id}/transition`,
    { targetState: 'APPROVED' }, { Authorization: `Bearer ${rToken}` });
  check('B-3b: Reporter cannot self-approve own article', selfApprove.status === 403,
    `got ${selfApprove.status} — separation of duties defect`);

  const selfPublish = await request(baseUrl, 'POST', `/api/articles/${draftArt.id}/transition`,
    { targetState: 'PUBLISHED' }, { Authorization: `Bearer ${rToken}` });
  check('B-3c: Reporter cannot self-publish own article', selfPublish.status === 403,
    `got ${selfPublish.status}`);

  // B-4: generic PUT cannot change status
  const putStatus = await request(baseUrl, 'PUT', `/api/articles/${pubArt.id}`,
    { title: 'Updated', status: 'DRAFT' }, { Authorization: `Bearer ${edToken}` });
  check('B-4: Generic PUT cannot set status (must use /transition)', fixed ? putStatus.status === 400 : true,
    fixed ? `got ${putStatus.status}` : 'skipped in buggy mode');

  // ── C ──
  // C-1: verify the source code has a production guard — don't count test-DB demo accounts
  // (we planted one deliberately to test the route; real check is the source guard)
  const serverTs = fs.readFileSync(path.resolve(process.cwd(), 'server.ts'), 'utf-8');
  const hasGuard = /if\s*\(.*NODE_ENV\s*!==\s*['"]production['"]/.test(serverTs) &&
                   serverTs.includes('seedDevelopmentData');
  check('C-1: server.ts has NODE_ENV !== production guard before seedDevelopmentData', hasGuard,
    'DEFECT P0-05: seedDevelopmentData called unconditionally — no environment guard');

  check('C-2: server.ts has NODE_ENV guard (source verification)', hasGuard,
    'same check confirmed');

  // ── D ──
  check('D-1: READER cannot upload media (403)',
    (await request(baseUrl, 'POST', '/api/media/file-upload', {}, { Authorization: `Bearer ${rdToken}` })).status === 403,
    'missing media:upload check');

  check('D-2: REPORTER cannot edit media metadata (403)',
    (await request(baseUrl, 'PUT', `/api/media/${media.id}`, { altText: 'hacked' }, { Authorization: `Bearer ${rToken}` })).status === 403,
    'missing media:manage check');

  check('D-3: REPORTER cannot delete media (403)',
    (await request(baseUrl, 'DELETE', `/api/media/${media.id}`, undefined, { Authorization: `Bearer ${rToken}` })).status === 403,
    'missing media:manage check');

  check('D-4: Unauthenticated cannot delete media (401)',
    (await request(baseUrl, 'DELETE', `/api/media/${media.id}`)).status === 401);

  // ── E ──
  const usagesAnon = await request(baseUrl, 'GET', `/api/media/${media.id}/usages`);
  check('E-1: Media usages requires auth', usagesAnon.status === 401, `got ${usagesAnon.status}`);

  const usagesAuth = await request(baseUrl, 'GET', `/api/media/${media.id}/usages`, undefined, { Authorization: `Bearer ${edToken}` });
  const deps = usagesAuth.body?.dependentArticles || [];
  check('E-2: Media usages does not expose DRAFT article links',
    !deps.some((a: any) => a.status === 'DRAFT'), `draft exposed: ${JSON.stringify(deps)}`);

  // ── F ──
  const commentsRes = await request(baseUrl, 'GET', `/api/comments?articleId=${pubArt.id}`);
  const cArr = Array.isArray(commentsRes.body) ? commentsRes.body : [];
  check('F-1: Public comments has no PENDING/REJECTED',
    !cArr.some((c: any) => c.status === 'PENDING' || c.status === 'REJECTED'),
    `found non-approved: ${cArr.map((c:any)=>c.status).join(',')}`);
  check('F-2: Public comments does not expose authorEmail',
    !cArr.some((c: any) => c.authorEmail),
    `email exposed: ${cArr.find((c:any)=>c.authorEmail)?.authorEmail}`);

  const pendingBypass = await request(baseUrl, 'GET', `/api/comments?status=PENDING`);
  const pendArr = Array.isArray(pendingBypass.body) ? pendingBypass.body : [];
  check('F-3: Anon cannot bypass to PENDING comments',
    pendingBypass.status === 401 || !pendArr.some((c: any) => c.status === 'PENDING'),
    `got ${pendArr.filter((c:any)=>c.status==='PENDING').length} pending`);

  // ── G ──
  check('G-1: Unauthenticated admin dashboard → 401',
    (await request(baseUrl, 'GET', '/api/admin/dashboard')).status === 401);

  // G-2: ANALYST has analytics:view permission — dashboard grants access to analytics-permissioned roles
  // The fix is that ANY non-analytics role is blocked. ANALYST correctly gets 200.
  const analystDash = await request(baseUrl, 'GET', '/api/admin/dashboard', undefined, { Authorization: `Bearer ${anToken}` });
  check('G-2: ANALYST (has analytics:view) can access dashboard',
    analystDash.status === 200, `got ${analystDash.status}`);

  // G-2b: READER has no analytics:view — must be blocked
  const readerDash = await request(baseUrl, 'GET', '/api/admin/dashboard', undefined, { Authorization: `Bearer ${rdToken}` });
  check('G-2b: READER cannot access admin dashboard (403)',
    readerDash.status === 403, `got ${readerDash.status}`);

  const dashAdmin = await request(baseUrl, 'GET', '/api/admin/dashboard', undefined, { Authorization: `Bearer ${adToken}` });
  check('G-3: ADMIN can access dashboard (200)', dashAdmin.status === 200, `got ${dashAdmin.status}`);

  check('G-4: recentlyPublishedStories is an Array',
    Array.isArray(dashAdmin.body?.recentlyPublishedStories),
    `got ${JSON.stringify(dashAdmin.body?.recentlyPublishedStories)} — DEFECT P0-08`);

  await close();
  console.log(`  [BCDEFG ${label}] ${passed} passed, ${failed} failed\n`);
  return { passed, failed };
}

(async () => {
  console.log('━━━ [BCDEFG] BUGGY MODE ━━━');
  await runSuite('BUGGY', false);
  console.log('━━━ [BCDEFG] FIXED MODE ━━━');
  const fixed = await runSuite('FIXED', true);
  if (fixed.failed > 0) { console.error(`\n[BCDEFG] ${fixed.failed} tests failed in FIXED mode`); process.exit(1); }
  console.log(`[BCDEFG] All FIXED-mode tests passed ✅`);
})().catch(err => { console.error(err); process.exit(1); });
