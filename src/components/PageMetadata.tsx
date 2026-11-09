import React from 'react';
import { Helmet } from 'react-helmet';
import { absoluteUrl, canonicalUrl as buildCanonical } from '../urls';

interface PageMetadataProps {
  title: string;
  description: string;
  /** Server-recognized canonical path for this route ("", "/latest", "/article/x", "/search"). */
  canonicalPath?: string;
  /** Escape hatch for precomputed canonical URLs. */
  canonicalUrl?: string;
  ogImage?: string;
  type?: 'article' | 'website';
  publishedAt?: string;
  modifiedAt?: string;
  authorName?: string;
  /** Document content language (NOT the reader's UI toggle). */
  lang?: 'en' | 'bn';
  /** Only pass when genuinely equivalent translations exist — none are fabricated. */
  alternateLinks?: { lang: string; url: string }[];
}

export const PageMetadata: React.FC<PageMetadataProps> = ({
  title,
  description,
  canonicalPath,
  canonicalUrl: canonicalUrlProp,
  ogImage,
  type = 'website',
  publishedAt,
  modifiedAt,
  authorName,
  lang = 'en',
  alternateLinks = [],
}) => {
  // Canonical comes from the validated server-only APP_URL (window.__GC_APP_URL__)
  // plus the route's canonical path — never window.location.href, which carries
  // navigation noise (tab hashes were removed in sharing anyway) and would
  // diverge from the server-rendered canonical.
  const resolvedCanonical =
    canonicalUrlProp || (canonicalPath !== undefined ? buildCanonical(canonicalPath) : undefined) ||
    absoluteUrl(typeof window !== 'undefined' ? window.location.pathname : '/');
  return (
    <Helmet>
      <html lang={lang} />
      <title>{title} | Global Chronicle</title>
      <meta name="description" content={description} />
      <link rel="canonical" href={resolvedCanonical} />

      {alternateLinks.map((link) => (
        <link key={link.lang} rel="alternate" hrefLang={link.lang} href={link.url} />
      ))}

      <meta property="og:title" content={title} />
      <meta property="og:description" content={description} />
      <meta property="og:type" content={type} />
      <meta property="og:url" content={resolvedCanonical} />
      {ogImage && <meta property="og:image" content={ogImage} />}

      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={title} />
      <meta name="twitter:description" content={description} />
      {ogImage && <meta name="twitter:image" content={ogImage} />}

      {publishedAt && <meta property="article:published_time" content={publishedAt} />}
      {modifiedAt && <meta property="article:modified_time" content={modifiedAt} />}
      {authorName && <meta property="article:author" content={authorName} />}
    </Helmet>
  );
};
