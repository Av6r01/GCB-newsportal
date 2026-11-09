# Routing & SEO Implementation Note — Phase 9 (Public URLs)

**Date:** 2026-11-08 · **Decision owner:** engineering · **Status:** adopted

## 1. Inspection findings

| Area | Current state | Problem |
|---|---|---|
| Client navigation | Single `App.tsx` holds `currentView`/`currentSlug` **state**; every view is a callback `setState` — no `react-router`, no History API use | Refresh / back-forward / deep links broken: any URL other than `/` boots to Home; browser back leaves the site |
| URLs | No public paths exist at all — the Express SPA fallback serves `index.html` for everything, and the client ignores the path | Article/section URLs cannot be shared, crawled or canonicalized |
| Canonical URLs | `PageMetadata` (react-helmet) sets `canonical: window.location.href` (query/fragment noise included) | Not absolute-authoritative; not derived from a configured origin |
| APP_URL | Server sitemap/robots use `process.env.VITE_APP_URL \|\| localhost` — a **client-flavored env var in server code** | Canonical origin must be one validated **server-only** `env.APP_URL` (already exists in `src/configuration/env.ts`) |
| Crawler availability | All content client-side (Vite SPA + client `fetch`); `index.html` is static boilerplate | Article title/body/metadata invisible to non-rendering crawlers; JSON-LD + helmet tags render only after JS |
| Metadata correctness | ArticleDetail JSON-LD hardcodes AI Studio `run.app` logo; `NewsArticle` lacks `mainEntityOfPage`/description | Un-owned asset; incomplete structured data |
| Language | `index.html` fixed `lang="en"`; UI has en/bn switch; article content is single-language | `html lang` must reflect document language; no article-level translations exist |
| Sitemap | `sitemap.xml` includes only published articles; `sitemap-news.xml` uses an incorrect hand-rolled news payload and an unfiltered 48 h window (JSON driver ignores the `gte` range); **no XML escaping** of titles/slugs; categories/tags/authors/archive/latest missing; `sitemap-news` news XML is malformed per spec ordering | Incomplete + unsafe |
| RSS/Atom | Not present; product spec (`docs/PRODUCT_REQUIREMENTS.md`, feature matrices) does **not** advertise feeds | Not required by the brief — deferred, documented |
| Redirects | Phase 7 `UrlRedirect` records exist and are honored on `/api/articles/:slug` — but page-level `/article/<old>` HTML requests are not redirected | Old article URLs 404 at HTML level |

## 2. Router decision — keep the stack; no migration

The React/Vite + Express architecture **can** provide a sound solution:

- Express already serves the SPA for arbitrary paths (dev: Vite middleware; prod: `dist` + `*` fallback), so **refresh on deep paths already returns HTML** — only the client ignored it.
- A **small homegrown history router** (`src/router.tsx`, ~120 LOC, zero new dependencies) fits the existing callback-driven navigation exactly: existing `onSelectArticle`-style callbacks become one-line `navigate(path)` calls. No component rewrite beyond wiring.
- Full SSR (Next.js / Remix / vite-ssr) **is not required** and would be a framework migration — **not proposed**. The required crawler guarantee is met with targeted server-side HTML injection (§3), which is a standard "prerender-lite" pattern for SPA + Express stacks. If full SSR is ever wanted, that goes through a separate written proposal.

**URL map (stable, permanent):**

| Pattern | View |
|---|---|
| `/` | Homepage |
| `/category/:slug` | Category feed |
| `/category/:parent/:child` | Subcategory feed (categories support `parentId`) |
| `/article/:slug` | Article by stable slug (live blogs / galleries / video are enabled features *inside* the article document — no separate URLs exist in the product) |
| `/author/:id` | Author page |
| `/topic/:tagSlug` | Topic/tag page |
| `/latest` | Latest news wire |
| `/archive/:year(/:month)` | Date archive |
| `/search?q=` | Search results |
| `/cms/*` | Editorial CMS (client-protected; not public-SEO surface) |
| anything else | 404 page |

All links across components come from one module `src/urls.ts` (single source of truth, `encodeURIComponent` for every segment — Bangla slugs survive).

## 3. Crawler availability — server-side injection (prerender-lite), no SSR migration

Express gains an SEO HTML middleware **before** the static/Vite fallback, for browser-style page requests only (not `/api`, `/uploads`, dot-file assets):

1. Parse the route → load the **actual requested** record from the DB (article by slug, category, author, tag, query).
2. Serve the standard `index.html` shell with:
   - `<title>`, meta description, **absolute canonical from `env.APP_URL`**, OG/twitter tags, `html lang`,
   - `application/ld+json` `NewsArticle`/`BreadcrumbList`/`CollectionPage` built from the real record,
   - inside `<div id="root">`, a server-rendered **visible** `<h1>` + byline + excerpt + sanitized article body (plain-text-transformed, tags stripped server-side, so injection is XSS-safe) so crawlers that do not execute JS get the title/body directly; the React client takes over the same container on boot.
3. **Status codes are real**: nonexistent/private article ⇒ HTTP 404 page; known slug moved ⇒ HTTP 301 redirect from the Phase 7 `UrlRedirect` table at **page level** (parity with the API route).
4. Dev mode uses Vite's `transformIndexHtml` first, so HMR keeps working; production injects into `dist/index.html`.

Requirement 5 verdict: full SSR is **not** required; this stack satisfies the crawler guarantee with real HTML + structured data at request time.

## 4. APP_URL strategy

- Single source: `env.APP_URL` (**server-only**, already Zod-validated).
- New production guard: in production, `APP_URL` must be `https://` and must not be `localhost`/`127.0.0.1` — server refuses to boot otherwise (fail-fast, no silent localhost canonicals).
- The origin is injected into the served HTML as `window.__GC_APP_URL__` so client-rendered canonicals (react-helmet) match the server's: canonical = `APP_URL + canonicalPath` (content pages strip query strings; search keeps `?q=`).

## 5. Language tags

- `html lang` = the document content language: `en` for every article/section today; never switching `lang` to `bn` just because the reader toggled the UI language (that would mis-describe the document).
- Bangla UI remains aUI-layer choice (`LanguageContext`), not a content translation.
- `hreflang` alternate links are emitted **only for genuinely equivalent translations**. The article model has no translation fields today, so **no alternates are fabricated**; the injector reserves `alternates` support and the check is data-driven. Self-referencing `x-default`/`en` alternates are not emitted to avoid claiming equivalence that does not exist.

## 6. Sitemap / feed plan

- `src/server/seo.ts` central builders: strict `xmlEscape()` on **every** field (titles, slugs, names — Bangla text and `& < > " '` safe), `application/xml; charset=utf-8` content type.
- `sitemap.xml`: homepage, `/latest`, category tree (parent+children, from live categories), topic tags, authors with content, derived date archives, and all PUBLISHED articles with `lastmod` = `updatedAt`. Excludes DRAFT/PENDING/ARCHIVED/purged (archived articles are excluded exactly like unpublished — archive *pages* aggregate months, not the archived docs). URL count bounded (10,000 cap).
- `sitemap-news.xml`: fully spec-shaped `news:news` payload (publication name/language, W3C date, title) restricted to articles with `publishedAt` within 48 h **filtered in JS** (driver-safe — the JSON driver ignores `gte` ranges in `where`).
- `robots.txt` from `env.APP_URL`; references both sitemaps.
- RSS/Atom: **not advertised by the product specification** → not implemented in this phase; the injector + builder module makes it trivial later if spec adds it. Do not claim Google indexing/News inclusion anywhere — sitemaps are discovery aids only.

## 7. Test plan (actual response HTML)

`tests/p9/` boots the real app and requests real HTML/XML with exact inspected assertions:
- deep-link/refresh HTML for `/article/:slug` (published story) — title, canonical absolute APP_URL, JSON-LD parse with `NewsArticle.headline/datePublished/author`, body text presence,
- 404 HTML for draft/archived/deleted slugs (status 404, no body leak),
- page-level 301 for a changed slug (Phase 7 redirect table),
- sitemap: only published articles (draft/archived excluded), `lastmod` sanity, escaped entities for `&<>` + Bangla slugs, `Content-Type: application/xml`,
- news sitemap: within-48h in / out-of-window out, correct news payload order,
- homepage injection: absolute canonical + h1,
- Bangla slug route round-trip (encoded path → 200 → article body),
- `robots.txt` cites APP_URL.

## 8. Explicitly out of scope (no unilateral action)

- Framework/router-library migration (none proposed or required).
- Full SSR.
- RSS/Atom (un-advertised).
- Any claim of guaranteed Google indexing or News inclusion.
