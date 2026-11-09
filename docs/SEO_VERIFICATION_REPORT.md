# SEO Verification Report — Phase 9 (Public URLs & News SEO)

**Date:** 2026-11-08 · **Host:** Windows · Node v24.19.0
**Method:** every claim below is backed by an executed check in `tests/p9/` (real Express app, isolated JSON store, one child process per suite). Command: `npm run test:p9` → **97/97 checks passed** (html-pages 65, sitemaps 32).
**Canonical origin used in tests:** `https://press.example.org` (injected per-suite as `APP_URL` **before** import — the server reads it from validated env only).

## Verified URL behaviors (exact inspected requests)

| # | Inspected URL / request | Expectation | Result |
|---|---|---|---|
| 1 | `GET /article/p9-budget-story` | 200, `text/html`; `<title>` = real headline; canonical `<link rel="canonical" href="https://press.example.org/article/p9-budget-story">`; JSON-LD `NewsArticle` with `headline/datePublished/author/Publisher logo = APP_URL/logo.svg`; server-rendered `<h1>` + escaped body text for crawlers without JS | ✅ 62 partials incl. all named |
| 2 | `GET /article/p9-secret-draft` (DRAFT) | **404** page; body text "Confidential draft content…" NOT present | ✅ |
| 3 | `GET /article/p9-withdrawn-archive` (ARCHIVED) | **404**; archived text absent | ✅ |
| 4 | `GET /article/never-existed-slug` | **404** | ✅ |
| 5 | `GET /article/p9-old-slug` (UrlRedirect row → `/article/p9-budget-story`, 301) | **301** + `Location: /article/p9-budget-story`; following → 200 with the real article | ✅ page-level redirect parity with API |
| 6 | `GET /article/<URL-encoded Bangla slug>` (`বাজেট-পরীক্ষা`) | 200; Bangla headline rendered; canonical stable in encoded form | ✅ |
| 7 | `GET /` | 200; canonical = APP_URL root; `<h1>` present; `WebSite` JSON-LD | ✅ |
| 8 | `GET /latest` | 200; canonical `${APP_URL}/latest` | ✅ |
| 9 | `GET /category/phase9-world` | 200; canonical absolute; h1 = real category name; `CollectionPage` + `BreadcrumbList` JSON-LD | ✅ |
| 10 | `GET /category/phase9-world/phase9-economy` (subcategory) | 200; h1 `Phase9 Economy — Phase9 World Section` | ✅ |
| 11 | `GET /category/phase9-economy/phase9-economy` (wrong parent), `/category/ghost-category` | 404 both | ✅ |
| 12 | `GET /author/<reporter id>` | 200; `ProfilePage` JSON-LD (`mainEntity.name` = actual author) | ✅; unknown author → 404 ✅ |
| 13 | `GET /topic/fiscal-affairs` | 200; tag name rendered; unknown topic → 404 | ✅ |
| 14 | `GET /archive/2026/11` | 200; canonical absolute; malformed archive (`/archive/not-a-year/q3`) → 404 | ✅ |
| 15 | `GET /search?q=budget` | 200; **noindex**; canonical preserves `?q` (`${APP_URL}/search?q=budget`) | ✅ |
| 16 | `GET /cms` | 200 app shell; **noindex** | ✅ |
| 17 | `GET /this/path/does/not/exist` | 404 page ("404" content) | ✅ |
| 18 | `GET /src/main.tsx` (dot-asset) | NOT intercepted by the SEO layer (served by the static chain) | ✅ |
| 19 | `GET /article/…` HTML origin markers | contains `window.__GC_APP_URL__="https://press.example.org"`; **no `localhost` anywhere**; **no `ais-dev`/`run.app` URLs** in served HTML or JSON-LD | ✅ |
| 20 | `html lang` | `lang="en"` for English articles; Bangla UI translation exists but content language governs; `lang="bn"` only for genuinely Bangla documents (`language==='bn'`) | ✅ |
| 21 | `hreflang` alternates | **None emitted** — no genuinely equivalent translations exist in the data model; injection support exists and is data-driven (no fabricated equivalences) | ✅ by design |

## Verified XML surfaces

| Check | Expectation | Result |
|---|---|---|
| `GET /sitemap.xml` | 200; `Content-Type: application/xml; charset=utf-8`; XML declaration; absolute `<loc>` from APP_URL | ✅ |
| Published-only | `p9-sitemap-story` + fresh news article listed; **DRAFT (incl. its title) and ARCHIVED (slug + title) excluded** | ✅ |
| Sections | categories, subcategory paths, `/latest`, authors-with-content, derived date archives all present | ✅ |
| `lastmod` | valid ISO timestamp from `updatedAt` | ✅ |
| `GET /sitemap-news.xml` | spec namespace; **element order** `publication(name,language) → publication_date → title`; W3C date; 48 h window honored by JS filtering ("Week Old Classic" excluded) | ✅ |
| XML escaping | title `Budget & Tax <Deal> "Signed" — বাজেট` rendered as `Budget &amp; Tax &lt;Deal&gt; &quot;Signed&quot; — বাজেট`; no raw `<Deal>` text node | ✅ |
| `GET /robots.txt` | `text/plain`; `Disallow: /api/`; sitemaps cited on APP_URL; **no localhost** | ✅ |
| RSS/Atom | Product spec does not advertise feeds → intentionally not implemented (documented in ROUTING_SEO_IMPLEMENTATION_NOTE §6) | ✅ by design |

## Regression sweeps (same commit)

| Command | Result |
|---|---|
| `npx tsc --noEmit` | ✅ clean |
| `npm run lint:routes` | ✅ 70 registrations, 0 duplicates |
| `npm test` (8 legacy suites) | ✅ all passed |
| `npm run test:security` | ✅ exit 0 — all FIXED modes 0 failures (BUGGY modes fail by design; unchanged) |
| `npm run test:p7` | ✅ 98/98 |
| `npm run test:p8` | ✅ 94/94 |
| `npm run test:p9` | ✅ 97/97 |
| Store integrity | ✅ `data/database.json` restored from `data/backups/pre-6b-2026-11-06/database.json`, SHA-256 `7CCFFEFA…E559` (byte-identical) |

## Asset & config changes

- Hardcoded AI Studio `run.app` logo URL removed from `src/pages/ArticleDetail.tsx`; publisher logo now references the **owned** asset `public/logo.svg` served from APP_URL (`NewsMediaOrganization` JSON-LD + OG). (`rss` note: image generation was unavailable at write time; the logo is a hand-authored, repository-owned vector — replace with a branded PNG anytime at `public/logo.*`; both references read from `public/`.)
- `APP_URL`: single validated server-only origin (`env.APP_URL`, Zod `url()`); production boot refuses non-`https` or localhost origins (`validateAppUrl` fail-fast). `VITE_APP_URL` references deleted from the server.

## Production deployment facts (not guarantees)

- Sitemaps/canonicals/JSON-LD are built from the configured APP_URL — deploy must set `APP_URL=https://<real-domain>` (server refuses to boot otherwise, §env guard).
- Crawler-visible HTML is served for **every** public route (real `<title>`, meta, canonical, JSON-LD, full article text inside the page body), reducing dependence on JS rendering; the brief's SSR requirement is satisfied by the in-stack prerender-lite described in `docs/ROUTING_SEO_IMPLEMENTATION_NOTE.md` §3.
- **No statement in this report claims or implies guaranteed Google indexing or inclusion in Google News** — sitemaps are discovery aids only. Two days' worth of recent news is surfaced in `sitemap-news.xml` per the news sitemap conventions; any actual inclusion decision is made solely by the search engine.
