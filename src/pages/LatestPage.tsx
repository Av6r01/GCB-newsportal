/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phase 9: Latest news wire at the stable /latest URL — newest PUBLISHED
 * dispatches, paginated against the same API the rest of the portal uses.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { PageMetadata } from '../components/PageMetadata';
import { NewsCard } from '../components/design-system/NewsCard';
import { articleUrl } from '../urls';

interface LatestPageProps {
  onSelectArticle: (slug: string) => void;
}

export const LatestPage: React.FC<LatestPageProps> = ({ onSelectArticle }) => {
  const [articles, setArticles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const limit = 12;

  const fetchPage = useCallback(async (p: number) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/articles?page=${p}&limit=${limit}`);
      const data = await res.json();
      setArticles(Array.isArray(data.articles) ? data.articles : []);
      setTotal(data.pagination?.total ?? 0);
      setPage(p);
    } catch {
      setArticles([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetchPage(1); }, [fetchPage]);

  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <div className="max-w-7xl mx-auto px-4 md:px-8 py-10 space-y-8">
      <PageMetadata
        title="Latest News"
        description="The newest verified dispatches from the Global Chronicle wire, updated continuously."
        canonicalPath="/latest"
      />
      <h1 className="font-serif font-bold text-3xl md:text-4xl text-stone-900 border-b border-stone-200 pb-4">
        Latest News
      </h1>
      {loading ? (
        <div className="min-h-[40vh] flex items-center justify-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-stone-900" />
        </div>
      ) : (
        <>
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {articles.map((a: any) => (
              <NewsCard key={a.id} article={a} layout="vertical" onSelectArticle={onSelectArticle} />
            ))}
          </div>
          {totalPages > 1 && (
            <div className="flex justify-center gap-2">
              {Array.from({ length: totalPages }).slice(0, 10).map((_, i) => (
                <button
                  key={i}
                  onClick={() => void fetchPage(i + 1)}
                  className={`px-3 py-1 rounded text-sm ${page === i + 1 ? 'bg-stone-900 text-white' : 'bg-stone-100 text-stone-700 hover:bg-stone-200'}`}
                >
                  {i + 1}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
};
