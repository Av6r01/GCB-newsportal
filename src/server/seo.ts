/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phase 9: Public URLs & News SEO — shared server-side builders.
 *
 *   - xmlEscape: every dynamic field in every XML surface (titles, slugs,
 *     names — Bangla text, &, <, >, ", ') is escaped once, here.
 *   - Sitemap builders: sitemap.xml (published surface of the site) and
 *     sitemap-news.xml (spec-ordered news payload, 48 h eligibility window).
 *   - HTML SEO injection: serves the SPA shell with real <title>, meta,
 *     canonical (absolute, from the validated server-only APP_URL), JSON-LD
 *     structured data, html lang, and a server-rendered title/byline/body
 *     block inside #root so crawlers that never execute JS still see the
 *     article. React's createRoot().render() replaces that block on boot.
 *
 * All URLs run from env.APP_URL — never VITE_APP_URL, never localhost.
 * No code path claims or guarantees Google indexing / News inclusion.
 */

import fs from 'fs';
import path from 'path';
import { env } from '../configuration/env.ts';

export const APP_URL = env.APP_URL.replace(/\/+$/, '');

// ── XML / HTML escaping ─────────────────────────────────────────────────────
export function xmlEscape(text: unknown): string {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Attribute-scope HTML escape equivalent for text/nodes. */
export const escHtml = xmlEscape;

/** URL-encode a sitemap <loc> path while keeping legal URL characters. */
export function locEscape(routePath: string): string {
  // Path segments were encoded by url builders; loc as a whole needs XML escaping.
  return xmlEscape(routePath);
}

// ── Content → safe plain text (XSS-free server injection) ───────────────────
/**
 * HTML→text without any renderer: strips scripts/styles/tags, decodes the
 * minimal entity set, collapses whitespace. Output is inserted ONLY as text
 * nodes (never as attributes/tags) in the SSR shell.
 */
export function htmlToText(html: unknown, maxChars = 20_000): string {
  if (typeof html !== 'string') return '';
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text;
}

// ── Sitemaps ────────────────────────────────────────────────────────────────
export interface SitemapEntry {
  /** App-root-relative path from src/urls.ts builders (already segment-encoded). */
  loc: string;
  lastmod?: string | Date | null;
  changefreq?: string;
  priority?: string;
}

export function buildSitemapXml(entries: SitemapEntry[]): string {
  const urls = entries.map((e) => {
    const lastmod = e.lastmod ? new Date(e.lastmod) : null;
    const lastmodIso = lastmod && !Number.isNaN(lastmod.getTime())
      ? `<lastmod>${lastmod.toISOString()}</lastmod>`
      : '';
    return `<url><loc>${APP_URL}${locEscape(e.loc)}</loc>${lastmodIso}</url>`;
  });
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join('')}</urlset>`
  );
}

export interface NewsEntry {
  loc: string;
  title: string;
  /** ISO publication instant within the 48 h eligibility window. */
  publishedAt: string;
  publicationName?: string;
  language?: string;
}

/**
 * Google-News-shaped payload. Element order matters per the news sitemap
 * schema: <news:news> → <news:publication>(name, language) →
 * <news:publication_date> → <news:title>. Titles escape via xmlEscape.
 */
export function buildNewsSitemapXml(posts: NewsEntry[]): string {
  const urls = posts.map((p) =>
    `<url><loc>${APP_URL}${locEscape(p.loc)}</loc><news:news><news:publication><news:name>${xmlEscape(p.publicationName || 'Global Chronicle')}</news:name><news:language>${xmlEscape(p.language || 'en')}</news:language></news:publication><news:publication_date>${xmlEscape(p.publishedAt)}</news:publication_date><news:title>${xmlEscape(p.title)}</news:title></news:news></url>`,
  );
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">${urls.join('')}</urlset>`
  );
}

// ── SSR shell injection (prerender-lite) ────────────────────────────────────
export interface SeoPageData {
  title: string;
  description: string;
  /**
   * Canonical path (with query when the surface needs one, e.g. "/search?q=x")
   * without a leading origin — the absolute URL is APP_URL + this path.
   */
  canonicalPath: string;
  lang?: 'en' | 'bn';
  noindex?: boolean;
  jsonLd?: Array<Record<string, unknown>>;
  ogImage?: string;
  /**
   * Trusted server-BUILT fragment (title/outlet/byline/plain body) — html from
   * user input must pass through htmlToText + escHtml before it lands here.
   */
  bodyHtml?: string;
}

/**
 * Inject a full SEO head block + optional SSR body into the app shell.
 * - Only replaces a known static set from index.html (title/description/og),
 *   then appends our block, so there are never duplicate metas.
 * - html lang is updated for genuinely Bangla documents only.
 * - window.__GC_APP_URL__ propagates the validated origin to react-helmet.
 */
export function injectSeo(shellHtml: string, page: SeoPageData, appUrl = APP_URL): string {
  let html = shellHtml;

  // Strip the static boilerplate head elements we replace.
  html = html
    .replace(/<title>[\s\S]*?<\/title>/i, '')
    .replace(/<meta\s+name="description"\s+content="[^"]*"\s*\/?>/i, '')
    .replace(/<meta\s+property="og:title"\s+content="[^"]*"\s*\/?>/i, '')
    .replace(/<meta\s+property="og:description"\s+content="[^"]*"\s*\/?>/i, '')
    .replace(/<meta\s+property="og:type"\s+content="[^"]*"\s*\/?>/i, '');

  const lang = page.lang || 'en';

  const headLines = [
    `<title>${escHtml(page.title)}</title>`,
    `<meta name="description" content="${escHtml(page.description)}">`,
    page.noindex ? `<meta name="robots" content="noindex, nofollow">` : '',
    `<link rel="canonical" href="${escHtml(appUrl + page.canonicalPath)}">`,
    `<meta property="og:title" content="${escHtml(page.title)}">`,
    `<meta property="og:description" content="${escHtml(page.description)}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:url" content="${escHtml(appUrl + page.canonicalPath)}">`,
    page.ogImage ? `<meta property="og:image" content="${escHtml(page.ogImage)}">` : '',
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${escHtml(page.title)}">`,
    `<meta name="twitter:description" content="${escHtml(page.description)}">`,
    page.ogImage ? `<meta name="twitter:image" content="${escHtml(page.ogImage)}">` : '',
    `<script>window.__GC_APP_URL__=${JSON.stringify(appUrl)};</script>`,
    ...(page.jsonLd || []).map((obj) => `<script type="application/ld+json">${JSON.stringify(obj)}</script>`),
  ].filter(Boolean);

  if (/<html\s+lang="en"/i.test(html) && lang !== 'en') {
    html = html.replace(/<html\s+lang="en"/i, `<html lang="${escHtml(lang)}"`);
  }

  const seoful = html.includes('</head>');
  const headBlock = `\n${headLines.join('\n')}\n`;
  html = seoful ? html.replace('</head>', `${headBlock}</head>`) : `${headBlock}${html}`;

  if (page.bodyHtml) {
    // React's createRoot().render() replaces the container's children later,
    // so the SSR block below is transient — crawlers get real content first.
    html = html.replace(/(<div\s+id="root"[^>]*>)/i, `$1\n${page.bodyHtml}`);
  }
  return html;
}

/**
 * Shell loader: production reads dist/index.html once (cached), development
 * reads the root index.html and runs Vite's transformIndexHtml so HMR/preamble
 * keep working.
 */
export function createShellLoader(opts: { distDir: string; rootDir: string; vite?: any }): {
  get: (devRequestPath?: string) => Promise<string>;
} {
  let prodCache: string | null = null;
  return {
    async get(devRequestPath = '/'): Promise<string> {
      // In production, load the built dist/index.html
      if (process.env.NODE_ENV === 'production') {
        if (!prodCache) {
          const prodPath = path.join(opts.distDir, 'index.html');
          if (fs.existsSync(prodPath)) {
            prodCache = fs.readFileSync(prodPath, 'utf-8');
          }
        }
        if (prodCache) return prodCache;
      }
      // Development: root index.html + Vite transform (keeps /src/main.tsx and /@vite/client)
      const devPath = path.join(opts.rootDir, 'index.html');
      let raw = fs.readFileSync(devPath, 'utf-8');
      if (opts.vite) raw = await opts.vite.transformIndexHtml(devRequestPath, raw);
      return raw;
    },
  };
}
