/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phase 10: owned policy/standards pages for the public portal
 * (/page/:slug). Content is owned, reviewed copy from src/pages/publicPages.ts
 * — the same source the server SEO shell reads, so crawlers and readers see
 * the identical document.
 */
import React from 'react';
import { ChevronLeft } from 'lucide-react';
import { STATIC_PAGES } from './publicPages';

export interface PublicPageProps {
  slug: string;
  onBack: () => void;
}

export const PublicPage: React.FC<PublicPageProps> = ({ slug, onBack }) => {
  const page = STATIC_PAGES[slug];

  if (!page) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-16 text-center" data-public-page="unknown">
        <h1 className="font-serif font-bold text-3xl text-stone-900">Page not found</h1>
        <p className="text-sm text-stone-500 mt-2">No such standards page exists.</p>
        <button onClick={onBack} className="mt-6 text-xs font-semibold text-red-700 hover:underline">
          <ChevronLeft className="w-3.5 h-3.5 inline" /> Go back
        </button>
      </div>
    );
  }

  return (
    <article
      className="max-w-3xl mx-auto px-4 py-10"
      data-public-page={page.slug}
      aria-labelledby="static-page-title"
    >
      <button
        onClick={onBack}
        className="text-xs font-semibold text-stone-500 hover:text-stone-900 inline-flex items-center gap-1 mb-6"
      >
        <ChevronLeft className="w-3.5 h-3.5" /> Back
      </button>

      <h1 id="static-page-title" className="font-serif font-black text-4xl tracking-tight text-stone-900 dark:text-stone-100">
        {page.title}
      </h1>
      <p className="text-xs text-stone-400 mt-2">
        Last reviewed {page.reviewedAt} · Global Chronicle Bureau
      </p>

      <div className="mt-8 space-y-8">
        {page.sections.map((section) => (
          <section key={section.heading}>
            <h2 className="font-serif font-bold text-xl text-stone-900 dark:text-stone-100 mb-3">
              {section.heading}
            </h2>
            {section.paragraphs.map((paragraph, i) => (
              <p key={i} className="text-sm leading-relaxed text-stone-600 dark:text-stone-300 mb-3">
                {paragraph}
              </p>
            ))}
          </section>
        ))}
      </div>
    </article>
  );
};
