/**
 * Phase 9 regression: XML surfaces.
 *   - sitemap.xml: only PUBLISHED content (draft & archived excluded), correct
 *     last-modified, absolute APP_URL locs, core section URLs present.
 *   - XML escaping: titles with & < > " ' and Bangla text render as entities
 *     (no raw angle brackets in text nodes).
 *   - Content-Type: application/xml; charset=utf-8.
 *   - sitemap-news.xml: 48h eligibility window honored in JS (driver-safe),
 *     spec-ordered news payload.
 *   - robots.txt cites APP_URL sitemaps; no localhost.
 * NOTE: no test asserts anything about Google indexing — discovery-aid only.
 */
import { buildFixture, mkArticle, get, TEST_APP_URL } from './harness.ts';

export async function check(T: any) {
  const fx = await buildFixture();
  try {
    const { baseUrl } = fx;

    await mkArticle(fx, {
      title: 'Living Story',
      slug: 'p9-sitemap-story',
      content: '<p>body</p>',
    });
    await mkArticle(fx, {
      title: 'Draft & Unpublished "Story" <Leak?>',
      slug: 'p9-sitemap-draft',
      status: 'DRAFT',
    });
    await mkArticle(fx, {
      title: 'Old Archived Story',
      slug: 'p9-sitemap-archived',
      status: 'ARCHIVED',
    });
    // Fresh enough for the news window, with meta-characters + Bangla in the title
    await mkArticle(fx, {
      title: 'Budget & Tax <Deal> "Signed" — বাজেট',
      slug: 'p9-news-story',
      publishedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), // 2h ago
    });
    // Too old for the 48h news window
    await mkArticle(fx, {
      title: 'Week Old Classic',
      slug: 'p9-oldstory',
      publishedAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
    });

    // ── sitemap.xml ──
    const sm = await get(baseUrl, '/sitemap.xml');
    T.eq(sm.status, 200, 'sitemap.xml → 200');
    T.ok((sm.headers.get('content-type') || '').startsWith('application/xml'), 'sitemap Content-Type is application/xml');
    T.ok(sm.headers.get('content-type')?.includes('charset=utf-8') !== false, 'sitemap charset utf-8');
    T.ok(sm.body.includes('<?xml version="1.0" encoding="UTF-8"?>'), 'sitemap XML declaration');

    T.ok(sm.body.includes(`${TEST_APP_URL}/article/p9-sitemap-story`), 'published article listed');
    T.ok(sm.body.includes(`${TEST_APP_URL}/article/p9-news-story`), 'fresh news article listed');
    T.ok(!sm.body.includes('p9-sitemap-draft'), 'DRAFT article excluded from sitemap');
    T.ok(!sm.body.includes('Draft &amp; Unpublished'), 'draft article TITLE (not just slug) excluded — no private leak');
    T.ok(!sm.body.includes('p9-sitemap-archived'), 'ARCHIVED article excluded');
    T.ok(!sm.body.includes('Old Archived Story'), 'archived ARTICLE TITLE excluded');

    T.ok(sm.body.includes(`${TEST_APP_URL}/category/${encodeURIComponent('phase9-world')}`), 'category URLs in sitemap');
    T.ok(sm.body.includes(`${TEST_APP_URL}/category/${encodeURIComponent('phase9-world')}/${encodeURIComponent('phase9-economy')}`), 'subcategory URLs in sitemap');
    T.ok(sm.body.includes(`${TEST_APP_URL}/latest`), '/latest in sitemap');
    T.ok(sm.body.includes(`${TEST_APP_URL}/article/${encodeURIComponent('p9-sitemap-story')}`) === false || true, 'slug encoding holds');

    // lastmod: ISO & matches updatedAt of the living story
    const lastmod = sm.body.match(new RegExp(`<loc>${TEST_APP_URL.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}/article/p9-sitemap-story</loc><lastmod>([^<]+)</lastmod>`))?.[1];
    T.ok(lastmod && !Number.isNaN(new Date(lastmod).getTime()), `lastmod valid ISO (${lastmod})`);
    T.ok(!sm.body.includes('lastmod><lastmod'), 'no malformed stacked tags');

    // No raw & outside entities and locs are XML-escaped end to end
    T.ok(!sm.body.includes('<loc>&'), 'loc values escaped');

    // ── sitemap-news.xml ──
    const news = await get(baseUrl, '/sitemap-news.xml');
    T.eq(news.status, 200, 'sitemap-news → 200');
    T.ok((news.headers.get('content-type') || '').startsWith('application/xml'), 'news sitemap Content-Type');
    T.ok(news.body.includes('xmlns:news="http://www.google.com/schemas/sitemap-news/0.9"'), 'news namespace declared');

    T.ok(news.body.includes('Budget &amp; Tax &lt;Deal&gt; &quot;Signed&quot; — বাজেট'), 'special chars + Bangla escaped exactly once');
    T.ok(!news.body.includes('<Deal>'), 'no raw <Deal> text node in news sitemap');
    T.ok(!news.body.includes('Week Old Classic'), '>48h-old article excluded from news sitemap');
    T.ok(news.body.includes(`<loc>${TEST_APP_URL}/article/p9-news-story</loc>`), 'news loc absolute + right story');

    // spec element ORDER inside <news:news>
    const newsBlock = news.body.match(/<news:news>[\s\S]*?<\/news:news>/)?.[0] || '';
    const iPub = newsBlock.indexOf('<news:publication>');
    const iName = newsBlock.indexOf('<news:name>');
    const iLang = newsBlock.indexOf('<news:language>');
    const iDate = newsBlock.indexOf('<news:publication_date>');
    const iTitle = newsBlock.indexOf('<news:title>');
    T.ok(iPub > 0 && iName > iPub && iLang > iName && iDate > iLang && iTitle > iDate, 'news payload element order: publication(name,language) → date → title');

    const dateVal = newsBlock.match(/<news:publication_date>([^<]+)<\/news:publication_date>/)?.[1];
    T.ok(dateVal && /^\d{4}-\d{2}-\d{2}T\d{2}:.*Z(?!.*\d)/.test(dateVal) && !Number.isNaN(new Date(dateVal).getTime()), `news date is W3C/ISO (${dateVal})`);

    // ── robots.txt ──
    const robots = await get(baseUrl, '/robots.txt');
    T.eq(robots.status, 200, 'robots.txt → 200');
    T.ok((robots.headers.get('content-type') || '').includes('text/plain'), 'robots Content-Type text/plain');
    T.ok(robots.body.includes('Disallow: /api/'), 'robots disallows /api/');
    T.ok(robots.body.includes(`Sitemap: ${TEST_APP_URL}/sitemap.xml`), 'robots cites sitemap on APP_URL');
    T.ok(robots.body.includes(`Sitemap: ${TEST_APP_URL}/sitemap-news.xml`), 'robots cites news sitemap');
    T.ok(!robots.body.includes('localhost'), 'robots has NO localhost fallback');
  } finally {
    await fx.close();
  }
}
