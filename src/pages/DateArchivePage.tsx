import React, { useState, useEffect } from 'react';
import { Clock, ArrowLeft } from 'lucide-react';
import { PageMetadata } from '../components/design-system/PageMetadata';
import { Pagination } from '../components/design-system/Pagination';
import { NewsCard } from '../components/design-system/NewsCard';

interface DateArchivePageProps {
  year: string;
  month: string;
  onSelectArticle: (slug: string) => void;
  onBack: () => void;
}

export const DateArchivePage: React.FC<DateArchivePageProps> = ({ year, month, onSelectArticle, onBack }) => {
  const [articles, setArticles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState({ total: 0, page: 1, limit: 10 });

  const fetchArticles = async (page: number) => {
    setLoading(true);
    try {
      // Phase 9: year-only archives ("/archive/2026") also supported
      const query = month ? `&month=${month}` : '';
      const res = await fetch(`/api/articles?year=${year}${query}&page=${page}&limit=9`);
      const data = await res.json();
      setArticles(data.articles || []);
      setPagination(data.pagination || { total: 0, page: 1, limit: 10 });
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchArticles(1);
  }, [year, month]);

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-stone-900"></div>
      </div>
    );
  }

  const totalPages = Math.ceil(pagination.total / pagination.limit);
  const dateStr = month
    ? new Date(parseInt(year), parseInt(month) - 1).toLocaleString('default', { month: 'long', year: 'numeric' })
    : String(year);

  return (
    <div className="max-w-7xl mx-auto px-4 md:px-8 py-10 space-y-8">
      <PageMetadata
        title={`Archive: ${dateStr}`}
        description={`Editorial archives for ${dateStr}.`}
        canonicalPath={`/archive/${encodeURIComponent(String(year))}${month ? `/${encodeURIComponent(String(month))}` : ''}`}
      />
      <button
        onClick={onBack}
        className="flex items-center space-x-2 text-stone-600 hover:text-stone-950 font-medium text-sm transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        <span>Return to Home</span>
      </button>

      <div className="border-b border-stone-200 pb-4">
        <h1 className="font-serif font-bold text-3xl md:text-4xl text-stone-900">
          {dateStr}
        </h1>
        <p className="text-stone-500 text-sm mt-1">
          Historical archive of dispatches published in {dateStr}.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        {articles.length > 0 ? (
          articles.map((art) => (
            <div
              key={art.id}
              onClick={() => onSelectArticle(art.slug)}
              className="group cursor-pointer bg-white border border-stone-200 rounded-xl overflow-hidden shadow-xs hover:shadow-md transition-shadow flex flex-col"
            >
              <div className="relative aspect-video overflow-hidden bg-stone-100">
                <img src={art.coverImage} alt={art.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
              </div>
              <div className="p-5 flex-1 flex flex-col justify-between space-y-3">
                <h3 className="font-serif font-bold text-lg text-stone-900 group-hover:text-red-700 transition-colors leading-snug">
                  {art.title}
                </h3>
                <p className="text-stone-600 text-xs line-clamp-3">{art.excerpt}</p>
                <div className="flex items-center justify-between text-xs text-stone-500 pt-3 border-t border-stone-100">
                  <span className="font-semibold text-stone-800">{art.author.name}</span>
                  <span className="flex items-center space-x-1">
                    <Clock className="w-3 h-3" />
                    <span>{new Date(art.publishedAt || art.createdAt).toLocaleDateString()}</span>
                  </span>
                </div>
              </div>
            </div>
          ))
        ) : (
          <div className="col-span-3 py-20 text-center text-stone-500 italic">
            No articles found for this period.
          </div>
        )}
      </div>

      <Pagination 
        currentPage={pagination.page} 
        totalPages={totalPages} 
        onPageChange={fetchArticles} 
      />
    </div>
  );
};
