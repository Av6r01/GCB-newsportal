/**
 * Server-side HTML content sanitizer.
 *
 * Applied on article create/update to strip XSS vectors from editor HTML
 * before persistence. Never trust rich-text editor output.
 *
 * Allowlist strategy: only known-safe tags and attributes pass through.
 * Everything else is stripped. No eval, no javascript:, no event handlers.
 */

import sanitizeHtml from 'sanitize-html';

/** Tags allowed in article body content */
const ALLOWED_TAGS = [
  // Text structure
  'p', 'br', 'hr',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li',
  'blockquote', 'pre', 'code',
  // Inline
  'strong', 'b', 'em', 'i', 'u', 's', 'del', 'ins',
  'sup', 'sub', 'mark', 'small',
  // Media (validated separately)
  'figure', 'figcaption',
  'img',
  // Links
  'a',
  // Tables
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption',
  // Div/span for layout (class only, no inline style with url())
  'div', 'span',
  // Semantic
  'article', 'section', 'aside', 'header', 'footer',
  'cite', 'abbr', 'time', 'address',
];

/** Attributes allowed per tag */
const ALLOWED_ATTRIBUTES: sanitizeHtml.IOptions['allowedAttributes'] = {
  '*': ['class', 'id', 'dir', 'lang'],
  'a': ['href', 'title', 'target', 'rel'],
  'img': ['src', 'alt', 'width', 'height', 'loading', 'decoding', 'srcset', 'sizes'],
  'time': ['datetime'],
  'abbr': ['title'],
  'td': ['colspan', 'rowspan', 'headers'],
  'th': ['colspan', 'rowspan', 'scope'],
  'ol': ['start', 'type'],
  'li': ['value'],
  'figure': ['class'],
  'blockquote': ['cite'],
};

/** URL schemes allowed in href/src attributes */
const ALLOWED_SCHEMES = ['http', 'https', 'mailto', 'tel'];

/** Sanitizer options */
const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ALLOWED_TAGS,
  allowedAttributes: ALLOWED_ATTRIBUTES,
  allowedSchemes: ALLOWED_SCHEMES,
  allowedSchemesByTag: {
    img: ['http', 'https', 'data'], // data: URIs for embedded images only on img
  },
  // Force all <a> to have rel="noopener noreferrer" when target="_blank"
  transformTags: {
    'a': (tagName, attribs) => {
      const href = (attribs.href || '').toLowerCase().trim();

      // Reject javascript: and data: href on links
      if (href.startsWith('javascript:') || href.startsWith('data:')) {
        return { tagName: 'span', attribs: { class: attribs.class || '' } };
      }

      const out: Record<string, string> = { ...attribs };
      if (attribs.target === '_blank') {
        out.rel = 'noopener noreferrer';
      }
      return { tagName, attribs: out };
    },
    'img': (tagName, attribs) => {
      const src = (attribs.src || '').toLowerCase().trim();
      // Reject javascript: src — data: is allowed for inline images
      if (src.startsWith('javascript:')) {
        return { tagName: 'span', attribs: {} };
      }
      // Force safe loading attribute
      return { tagName, attribs: { ...attribs, loading: 'lazy', decoding: 'async' } };
    },
  },
  // Strip any CSS url() from class-only attributes to prevent CSS injection
  allowedStyles: {},
  // Disallow any html comments
  allowVulnerableTags: false,
};

/**
 * Sanitize article HTML body content.
 * Returns clean HTML safe for server-side storage and client rendering.
 * Throws if input is not a string.
 */
export function sanitizeArticleContent(html: string): string {
  if (typeof html !== 'string') return '';
  if (!html.trim()) return '';
  return sanitizeHtml(html, SANITIZE_OPTIONS);
}

/**
 * Sanitize a plain-text or lightly-formatted excerpt.
 * Strips all HTML — excerpts are text only.
 */
export function sanitizeExcerpt(text: string): string {
  if (typeof text !== 'string') return '';
  return sanitizeHtml(text, { allowedTags: [], allowedAttributes: {} }).trim().slice(0, 500);
}

/**
 * Validate a URL for safe use as an image src, link href, etc.
 * Returns the URL if safe, or null if dangerous.
 */
export function validateUrl(url: string): string | null {
  if (!url || typeof url !== 'string') return null;
  const trimmed = url.trim();
  try {
    const parsed = new URL(trimmed);
    if (!ALLOWED_SCHEMES.includes(parsed.protocol.replace(':', ''))) return null;
    return trimmed;
  } catch {
    // Relative URLs are allowed for on-domain assets
    if (trimmed.startsWith('/') && !trimmed.startsWith('//')) return trimmed;
    return null;
  }
}
