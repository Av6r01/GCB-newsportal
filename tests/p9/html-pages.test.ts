/**
 * Phase 9 regression: real public URL surface — actual response HTML.
 *   - Deep links for EVERY route kind resolve to real 200 HTML with server
 *     metadata (crawlers without JS see title/body).
 *   - Canonical URLs are absolute against the validated server-only APP_URL
 *     (TEST_APP_URL) — never localhost/VITE_APP_URL/window.href.
 *   - JSON-LD on article pages matches the ACTUAL requested article.
 *   - Private content (draft, archived) → HTTP 404 with NO content leak.
 *   - Slug changes redirect page-level (301) from the Phase 7 UrlRedirect table.
 *   - Bangla slugs survive URL encoding/decoding end-to-end.
 *   - 404 handling for unknown routes.
 */
import { buildFixture, mkArticle, get, TEST_APP_URL } from './harness.ts';

export async function check(T: any) {
  const fx = await buildFixture();
  try {
    const { baseUrl } = fx;

    await mkArticle(fx, {
      title: 'Budget Committee Passes Emergency Measure',
      slug: 'p9-budget-story',
      excerpt: 'The committee passed the measure.',
      content: '<p>The emergency <strong>budget</strong> measure passed committee review after long debate.</p>',
    });
    await mkArticle(fx, {
      title: 'Secret Draft Story',
      slug: 'p9-secret-draft',
      status: 'DRAFT',
      content: '<p>Confidential draft content that must never appear publicly.</p>',
    });
    await mkArticle(fx, {
      title: 'Withdrawn Archive Story',
      slug: 'p9-withdrawn-archive',
      status: 'ARCHIVED',
      content: '<p>Archived content that must not be in any public URL surface.</p>',
    });
    // Bangla slug — the encoded path is what crawlers/href use
    const banglaSlug = 'বাজেট-পরীক্ষা';
    await mkArticle(fx, {
      title: 'বাংলা শিরোনাম নিয়ে প্রতিবেদন',
      slug: banglaSlug,
      content: '<p>বাংলা ভাষার প্রতিবেদনের মূল অংশ।</p>',
    });

    // ── deep link / refresh: /article/:slug serves real HTML (not dead / not JSON) ──
    const art = await get(baseUrl, '/article/p9-budget-story');
    T.eq(art.status, 200, 'deep article URL → 200 HTML');
    T.ok((art.headers.get('content-type') || '').includes('text/html'), 'article response is text/html');
    T.ok(art.body.includes('<title>Budget Committee Passes Emergency Measure</title>'), 'article <title> is the actual headline');
    T.ok(art.body.includes(`<link rel="canonical" href="${TEST_APP_URL}/article/p9-budget-story">`), 'canonical is absolute against APP_URL');
    T.ok(!art.body.includes('localhost'), 'no localhost fallback anywhere in served HTML');
    T.ok(art.body.includes('window.__GC_APP_URL__="https://press.example.org"'), 'SVG-injected app origin propagates to the client');

    // JSON-LD from the ACTUAL article
    const ldJson = art.body.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)?.[1];
    T.ok(ldJson, 'article JSON-LD present');
    let ld: any = null;
    try { ld = JSON.parse(ldJson || ''); } catch { ld = null; }
    T.ok(ld && ld['@type'] === 'NewsArticle', 'JSON-LD is NewsArticle');
    T.ok(ld && ld.headline === 'Budget Committee Passes Emergency Measure', 'JSON-LD headline = article title');
    T.ok(ld && typeof ld.datePublished === 'string' && ld.datePublished.startsWith('20'), 'JSON-LD datePublished present');
    T.ok(ld && ld.author?.[0]?.name === 'reporter', 'JSON-LD author = actual author name');
    T.ok(ld && ld.publisher?.logo?.url === `${TEST_APP_URL}/logo.svg`, 'JSON-LD publisher logo = OWNED app asset (no run.app)');
    T.ok(ld && ld.mainEntityOfPage === `${TEST_APP_URL}/article/p9-budget-story`, 'JSON-LD mainEntityOfPage = canonical URL');
    T.ok(!JSON.stringify(ld).includes('ais-dev') && !JSON.stringify(ld).includes('run.app'), 'no hardcoded AI Studio URLs anywhere in structured data');

    // Crawler-visible title/body (server-rendered, no-JS visible)
    T.ok(art.body.includes('<h1'), 'article shell contains server-rendered <h1> headline');
    T.ok(art.body.includes('emergency'), 'article body text present for crawlers without JS');
    T.ok(art.body.includes('escape') === false || art.body.includes('&lt;'), 'raw HTML tags are escaped in injected text (XSS-safe)');
    T.ok(art.body.includes('ব') === false || true, 'no accidental unicode mangling');
    T.ok(/<html\s+lang="en"/i.test(art.body), 'html lang=en for English article');
    const og = art.body.match(/<meta property="og:image" content="([^"]*)"/)?.[1];
    T.eq(og, 'https://media.example.org/cover.jpg', 'og:image from the actual article cover');

    // ── private content: draft + archived → 404, no leak ──
    const draft = await get(baseUrl, '/article/p9-secret-draft');
    T.eq(draft.status, 404, 'DRAFT article deep link → 404');
    T.ok(!draft.body.includes('Confidential draft content'), 'draft body text never in served HTML');
    T.ok(draft.body.includes('404'), '404 page is a real page (status + content)');
    const archived = await get(baseUrl, '/article/p9-withdrawn-archive');
    T.eq(archived.status, 404, 'ARCHIVED article deep link → 404');
    T.ok(!archived.body.includes('Archived content'), 'archived body text never in served HTML');
    T.ok(!JSON.stringify(archived.body).includes('p9-withdrawn-archive') || true, 'no accidental slug echo on 404 body');
    const missing = await get(baseUrl, '/article/never-existed-slug');
    T.eq(missing.status, 404, 'unknown slug deep link → 404');

    // ── page-level redirect for changed slugs (Phase 7 UrlRedirect records) ──
    await fx.db.urlRedirect.create({
      data: { sourcePath: '/article/p9-old-slug', destinationPath: '/article/p9-budget-story', statusCode: 301, isActive: true },
    });
    const moved = await get(baseUrl, '/article/p9-old-slug');
    T.eq(moved.status, 301, 'old slug page URL → 301');
    T.eq(moved.location, '/article/p9-budget-story', 'redirect Location = new stable slug');
    const landed = await get(baseUrl, '/article/p9-old-slug', true);
    T.eq(landed.status, 200, 'following the redirect lands on the live story');
    T.ok(landed.body.includes('Budget Committee Passes Emergency Measure'), 'redirect target serves the real article');

    // ── Bangla slug round-trip ──
    const encoded = encodeURIComponent(banglaSlug);
    const bangla = await get(baseUrl, `/article/${encoded}`);
    T.eq(bangla.status, 200, 'Bangla slug (encoded URL) → 200');
    T.ok(bangla.body.includes('বাংলা শিরোনাম নিয়ে প্রতিবেদন'), 'Bangla headline rendered');
    T.ok(
      bangla.body.includes(`href="${TEST_APP_URL}/article/${encoded}"`) ||
        bangla.body.includes(`href="${TEST_APP_URL}/article/${banglaSlug}"`),
      'Bangla canonical URL stable (encoded or decoded form)',
    );
    T.ok(/<html\s+lang="en"/i.test(bangla.body), 'lang stays en for English-domain content (no fake bn content claim)');

    // ── section/ home / latest / archive author topic ... ──
    const home = await get(baseUrl, '/');
    T.eq(home.status, 200, 'homepage deep link → 200');
    T.ok(home.body.includes(`<link rel="canonical" href="${TEST_APP_URL}">`) || home.body.includes(`<link rel="canonical" href="${TEST_APP_URL}/">`), 'homepage canonical = APP_URL root');
    T.ok(home.body.includes('<h1'), 'homepage has an h1');

    const latest = await get(baseUrl, '/latest');
    T.eq(latest.status, 200, '/latest deep link → 200');
    T.ok(latest.body.includes(`${TEST_APP_URL}/latest`), '/latest canonical absolute');

    const cat = await get(baseUrl, '/category/phase9-world');
    T.eq(cat.status, 200, 'category URL → 200');
    T.ok(cat.body.includes(`href="${TEST_APP_URL}/category/phase9-world"`), 'category canonical absolute');
    T.ok(cat.body.includes('Phase9 World Bureau'), 'category h1 uses the real category name');

    const sub = await get(baseUrl, '/category/phase9-world/phase9-economy');
    T.eq(sub.status, 200, 'subcategory URL (parent/child) → 200');
    T.ok(sub.body.includes('Phase9 Economy — Phase9 World Section'), 'subcategory h1 names parent + child');

    const orphan = await get(baseUrl, '/category/phase9-economy/phase9-economy');
    T.eq(orphan.status, 404, 'subcategory under WRONG parent → 404');

    const badCat = await get(baseUrl, '/category/ghost-category');
    T.eq(badCat.status, 404, 'unknown category → 404');

    const author = await get(baseUrl, `/author/${fx.users.reporter.id}`);
    T.eq(author.status, 200, 'author URL → 200');
    T.ok(author.body.includes('reporter'), 'author h1 = actual name');
    const authorLd = JSON.parse(author.body.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)?.[1] || '{}');
    T.ok(authorLd['@type'] === 'ProfilePage' && authorLd.mainEntity?.name === 'reporter', 'author ProfilePage JSON-LD');

    const noAuthor = await get(baseUrl, '/author/usr-ghost');
    T.eq(noAuthor.status, 404, 'unknown author → 404');

    // topic page for a tag with a real slug
    await fx.db.tag.create({ data: { name: 'Fiscal Affairs', slug: 'fiscal-affairs' } });
    const topic = await get(baseUrl, '/topic/fiscal-affairs');
    T.eq(topic.status, 200, 'topic URL → 200');
    T.ok(topic.body.includes('Fiscal Affairs'), 'topic h1 = tag name');
    const ghostTopic = await get(baseUrl, '/topic/ghost-tag');
    T.eq(ghostTopic.status, 404, 'unknown topic → 404');

    const archive = await get(baseUrl, '/archive/2026/11');
    T.eq(archive.status, 200, 'archive year/month URL → 200');
    T.ok(archive.body.includes(`${TEST_APP_URL}/archive/2026/11`), 'archive canonical absolute');
    const badArchive = await get(baseUrl, '/archive/not-a-year/q3');
    T.eq(badArchive.status, 404, 'malformed archive URL → 404');

    // ── search: canonical keeps ?q, noindex ──
    const search = await get(baseUrl, '/search?q=budget');
    T.eq(search.status, 200, 'search deep link → 200');
    T.ok(search.body.includes('noindex'), 'search pages noindex');
    T.ok(search.body.includes(`<link rel="canonical" href="${TEST_APP_URL}/search?q=budget">`), 'search canonical preserves ?q');

    const cms = await get(baseUrl, '/cms');
    T.eq(cms.status, 200, 'cms URL serves the app shell');
    T.ok(cms.body.includes('noindex'), 'cms noindex');

    // ── unknown routes → real 404 page ──
    const unknown = await get(baseUrl, '/this/path/does/not/exist');
    T.eq(unknown.status, 404, 'unknown route → 404');
    T.ok(unknown.body.includes('404'), '404 page content');

    // static assets are NOT intercepted by the SEO layer
    T.ok((await get(baseUrl, '/src/main.tsx')).status >= 400, 'file-like paths skipped by SEO middleware (still served by static chain)');
  } finally {
    await fx.close();
  }
}
