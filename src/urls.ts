/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phase 9: stable public URL builders — the single source of truth for every
 * internal link in the app (nav, cards, breadcrumbs, feeds, sitemap ordering).
 * All dynamic segments are URI-encoded so Bangla (or any non-ASCII) slugs
 * survive as real URLs. Absolute URL helpers take the validated server-only
 * APP_URL (injected as window.__GC_APP_URL__ — see server SEO middleware).
 */

/** Encode one path segment (keeps every slug — Bangla incl. — link-safe). */
export function seg(raw: string): string {
  return encodeURIComponent(raw);
}

export function baseUrl(): string {
  if (typeof window === 'undefined') return '';
  return (window as any).__GC_APP_URL__ || '';
}

/** Absolute URL for a path using the validated server-only APP_URL. */
export function absoluteUrl(path: string): string {
  return `${baseUrl()}${path}`;
}

/** Canonical differs per page: content pages drop the query; search keeps ?q. */
export function canonicalUrl(path: string, keepQuery = false): string {
  if (typeof window === 'undefined') return absoluteUrl(path);
  const query = keepQuery ? window.location.search : '';
  return `${absoluteUrl(path)}${query}`;
}

export function homeUrl(): string {
  return '/';
}

export function latestUrl(): string {
  return '/latest';
}

export function articleUrl(slug: string): string {
  return `/article/${seg(slug)}`;
}

/** Category (or subcategory — pass the child slug; parents render above it). */
export function categoryUrl(slug: string, parentSlug?: string): string {
  return parentSlug
    ? `/category/${seg(parentSlug)}/${seg(slug)}`
    : `/category/${seg(slug)}`;
}

export function authorUrl(authorId: string): string {
  return `/author/${seg(authorId)}`;
}

export function topicUrl(tagSlug: string): string {
  return `/topic/${seg(tagSlug)}`;
}

export function archiveUrl(year: string | number, month?: string | number): string {
  return month !== undefined
    ? `/archive/${encodeURIComponent(String(year))}/${encodeURIComponent(String(month))}`
    : `/archive/${encodeURIComponent(String(year))}`;
}

export function searchUrl(query: string): string {
  return `/search?q=${encodeURIComponent(query)}`;
}

/** Owned policy/standards page (about, standards, privacy, terms, contact). */
export function pageUrl(slug: string): string {
  return `/page/${seg(slug)}`;
}

/** CMS entry (client-protected; not a public SEO surface). */
export function cmsUrl(subPath = ''): string {
  return `/cms${subPath ? `/${subPath}` : ''}`;
}
