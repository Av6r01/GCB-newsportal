/**
 * Security Test A: Unpublished article exposure
 * DEFECTS: P0-06 (slug detail), P1 (list status bypass)
 * Run BUGGY mode first to confirm failures, then FIXED mode to confirm fixes.
 */
import { InMemoryTestDb } from './testDb.ts';
import { buildTestApp, signToken } from './appFactory.ts';
import { request } from './testApp.ts';

async function runSuite(label: string, fixed: boolean) {
  const db = new InMemoryTestDb();

  const cat = await db.category.create({ data: { id: 'cat-a', name: 'World', slug: 'world' } });
  const author = await db.user.create({ data: { email: 'author-a@gc.test', name: 'Author', role: 'REPORTER', passwordHash: 'x' } });
  const editor = await db.user.create({ data: { email: 'editor-a@gc.test', name: 'Editor', role: 'MANAGING_EDITOR', passwordHash: 'x' } });

  for (const [slug, status, title] of [
    ['secret-draft',    'DRAFT',      'SECRET DRAFT'],
    ['under-review',    'IN_REVIEW',  'UNDER REVIEW'],
    ['approved-story',  'APPROVED',   'APPROVED NOT PUB'],
    ['embargoed-story', 'SCHEDULED',  'EMBARGOED'],
    ['public-story',    'PUBLISHED',  'PUBLIC STORY'],
  ]) {
    await db.article.create({ data: { title, slug, excerpt: 'x', content: 'x', categoryId: cat.id, authorId: author.id, status } });
  }

  const { baseUrl, close } = await buildTestApp(db, { fixedRoutes: fixed });
  const editorToken = signToken({ id: editor.id, email: editor.email, role: editor.role, name: editor.name });
  let passed = 0, failed = 0;

  async function check(name: string, condition: boolean, failNote = '') {
    if (condition) { console.log(`  ✅ ${name}`); passed++; }
    else           { console.log(`  ❌ ${name}${failNote ? ' — ' + failNote : ''}`); failed++; }
  }

  // A-1..A-4: non-published slugs must return 404 for anonymous callers
  for (const [slug, status] of [['secret-draft','DRAFT'],['under-review','IN_REVIEW'],['approved-story','APPROVED'],['embargoed-story','SCHEDULED']]) {
    const res = await request(baseUrl, 'GET', `/api/articles/${slug}`);
    await check(`A: anon GET ${status} article → 404`, res.status === 404, `got ${res.status}, body.status=${res.body?.status}`);
  }

  // A-5: published article IS visible
  const pub = await request(baseUrl, 'GET', '/api/articles/public-story');
  await check('A: anon GET PUBLISHED article → 200', pub.status === 200, `got ${pub.status}`);

  // A-6: anon list ?status=DRAFT must not return drafts
  const listDraft = await request(baseUrl, 'GET', '/api/articles?status=DRAFT');
  const drafts = (Array.isArray(listDraft.body) ? listDraft.body : []).filter((a: any) => a.status === 'DRAFT');
  await check('A: anon GET ?status=DRAFT returns no drafts', drafts.length === 0, `got ${drafts.length} drafts`);

  // A-7: anon list ?status=IN_REVIEW must not return in-review
  const listReview = await request(baseUrl, 'GET', '/api/articles?status=IN_REVIEW');
  const inReview = (Array.isArray(listReview.body) ? listReview.body : []).filter((a: any) => a.status === 'IN_REVIEW');
  await check('A: anon GET ?status=IN_REVIEW returns none', inReview.length === 0, `got ${inReview.length}`);

  // A-8: preview route requires auth + permission
  const previewAnon = await request(baseUrl, 'GET', '/api/preview/secret-draft');
  await check('A: /api/preview/ without auth → 401', previewAnon.status === 401, `got ${previewAnon.status}`);

  const previewEditor = await request(baseUrl, 'GET', '/api/preview/secret-draft', undefined, { Authorization: `Bearer ${editorToken}` });
  await check('A: /api/preview/ with editor auth → 200', previewEditor.status === 200, `got ${previewEditor.status}`);

  // A-9: view counter not incremented on draft fetch
  const draftArt = db.data.articles.find(a => a.slug === 'secret-draft');
  const viewsBefore = draftArt?.views ?? 0;
  await request(baseUrl, 'GET', '/api/articles/secret-draft');
  const viewsAfter = db.data.articles.find(a => a.slug === 'secret-draft')?.views ?? 0;
  await check('A: draft view counter not incremented', viewsAfter <= viewsBefore, `views: ${viewsBefore} → ${viewsAfter}`);

  // A-10: sitemap contains only PUBLISHED
  const sitemapRes = await request(baseUrl, 'GET', '/sitemap.xml');
  const xml = String(sitemapRes.body || '');
  const noLeaks = !xml.includes('secret-draft') && !xml.includes('under-review') && !xml.includes('embargoed-story');
  await check('A: sitemap.xml contains only PUBLISHED slugs', noLeaks, 'non-published slug appeared in sitemap');

  await close();
  console.log(`  [A ${label}] ${passed} passed, ${failed} failed\n`);
  return { passed, failed };
}

(async () => {
  console.log('━━━ [A] BUGGY MODE (expect failures) ━━━');
  const buggy = await runSuite('BUGGY', false);
  console.log('━━━ [A] FIXED MODE (expect all pass) ━━━');
  const fixed = await runSuite('FIXED', true);
  const totalFailed = fixed.failed;
  if (totalFailed > 0) { console.error(`\n[A] ${totalFailed} tests failed in FIXED mode`); process.exit(1); }
  console.log(`\n[A] All FIXED-mode tests passed ✅`);
})().catch(err => { console.error(err); process.exit(1); });
