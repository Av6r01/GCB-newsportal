import React from 'react';
import { Helmet } from 'react-helmet';
import { canonicalUrl as buildCanonicalUrl } from '../../urls';

interface PageMetadataProps {
  title: string;
  description: string;
  /** Canonical path for this route (e.g. "/category/world") — absolute URLs come from the validated server-only APP_URL. */
  canonicalPath?: string;
  url?: string;
  image?: string;
}

export const PageMetadata: React.FC<PageMetadataProps> = ({ title, description, canonicalPath, url, image }) => {
  const fullTitle = `${title} | Global Chronicle News`;
  // Phase 9: canonical never uses raw window.location.href (navigation noise,
  // spoofable) — it is built from the validated server-injected APP_URL.
  const canonical = canonicalPath !== undefined
    ? buildCanonicalUrl(canonicalPath)
    : (url || (typeof window !== 'undefined' ? buildCanonicalUrl(window.location.pathname) : ''));

  return (
    <Helmet>
      <title>{fullTitle}</title>
      <meta name="description" content={description} />
      <meta property="og:title" content={fullTitle} />
      <meta property="og:description" content={description} />
      <meta property="og:type" content="website" />
      <meta property="og:url" content={canonical} />
      {image && <meta property="og:image" content={image} />}
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={fullTitle} />
      <meta name="twitter:description" content={description} />
      {image && <meta name="twitter:image" content={image} />}
      <link rel="canonical" href={canonical} />
    </Helmet>
  );
};
