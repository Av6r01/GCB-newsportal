/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phase 9: URL → typed-route parser (single definition mirrored by the server
 * SEO middleware in src/server/seo.ts so both sides agree on the URL map).
 *
 * /                        home
 * /latest                  latest news wire
 * /article/:slug           article document (live blogs/galleries/video live inside)
 * /category/:parent/:child subcategory (2 segments) or /category/:slug single
 * /author/:id              author profile
 * /topic/:tagSlug          topic/tag page
 * /archive/:year/:month    month archive   (year-only supported too)
 * /search?q=               search results
 * /page/:slug              owned policy/standards pages (about, standards, privacy, terms, contact)
 * /cms                     editorial CMS (client-protected)
 * anything else            404
 */

export type PublicRoute =
  | { kind: 'home' }
  | { kind: 'latest' }
  | { kind: 'article'; slug: string }
  | { kind: 'category'; slug: string; parentSlug?: string }
  | { kind: 'author'; authorId: string }
  | { kind: 'topic'; tagSlug: string }
  | { kind: 'archive'; year: string; month?: string }
  | { kind: 'search'; query: string }
  | { kind: 'page'; slug: string }
  | { kind: 'cms' }
  | { kind: 'notfound'; path: string };

function decode(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw; // malformed escapes fall through to 404 semantics downstream
  }
}

export function parseRoute(pathname: string, search?: string): PublicRoute {
  const path = pathname.replace(/\/+$/, '').toLowerCase();
  const parts = path.split('/').filter(Boolean);

  if (parts.length === 0) return { kind: 'home' };

  if (parts[0] === 'latest' && parts.length === 1) return { kind: 'latest' };

  if (parts[0] === 'article' && parts.length === 2) {
    return { kind: 'article', slug: decode(parts[1]) };
  }

  if (parts[0] === 'category' && (parts.length === 2 || parts.length === 3)) {
    return parts.length === 3
      ? { kind: 'category', slug: decode(parts[2]), parentSlug: decode(parts[1]) }
      : { kind: 'category', slug: decode(parts[1]) };
  }

  if (parts[0] === 'author' && parts.length === 2) {
    return { kind: 'author', authorId: decode(parts[1]) };
  }

  if (parts[0] === 'topic' && parts.length === 2) {
    return { kind: 'topic', tagSlug: decode(parts[1]) };
  }

  if (parts[0] === 'archive' && (parts.length === 2 || parts.length === 3)) {
    const year = decode(parts[1]);
    const month = parts.length === 3 ? decode(parts[2]) : undefined;
    if (/^\d{4}$/.test(year) && (month === undefined || /^\d{1,2}$/.test(month))) {
      return { kind: 'archive', year, month };
    }
  }

  if (parts[0] === 'search') {
    const query = new URLSearchParams(search || '').get('q') || '';
    return { kind: 'search', query };
  }

  if (parts[0] === 'page' && parts.length === 2) {
    return { kind: 'page', slug: decode(parts[1]) };
  }

  if (parts[0] === 'cms') return { kind: 'cms' };

  return { kind: 'notfound', path: pathname };
}
