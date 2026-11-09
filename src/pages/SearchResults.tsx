import React, { useState, useEffect } from 'react';
import { Search, Clock, ArrowLeft, ChevronLeft, ChevronRight } from 'lucide-react';
import { PageMetadata } from '../components/design-system/PageMetadata';

interface SearchResultsProps {
  query: string;
  onSelectArticle: (slug: string) => void;
  onBack: () => void;
}

export const SearchResults: React.FC<SearchResultsProps> = ({ query, onSelectArticle, onBack }) => {
  const [articles, setArticles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState({ total: 0, page: 1, limit: 10 });

  useEffect(() => {
    setLoading(true);
    fetch(`/api/articles?search=${encodeURIComponent(query)}&page=${pagination.page}&limit=${pagination.limit}`)
      .then((res) => res.json())
      .then((data) => {
        setArticles(data.articles || []);
        setPagination(data.pagination || { total: 0, page: 1, limit: 10 });
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [query, pagination.page]);

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-stone-900"></div>
      </div>
    );
  }

  const totalPages = Math.ceil(pagination.total / pagination.limit);

  return (
    <div className="max-w-4xl mx-auto px-4 md:px-8 py-10 space-y-8">
      <PageMetadata
        title={`${query ? `Search: ${query}` : 'Search'}`}
        description="Search the Global Chronicle archive of verified reporting."
        canonicalPath={`/search?q=${encodeURIComponent(query)}`}
      />
      <button
        onClick={onBack}
        className="flex items-center space-x-2 text-stone-600 hover:text-stone-950 font-medium text-sm transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        <span>Return to Home</span>
      </button>

      <div className="border-b border-stone-200 pb-4 space-y-2">
        <div className="flex items-center space-x-2 text-red-700">
          <Search className="w-5 h-5" />
          <span className="text-xs font-bold uppercase tracking-wider">Search Results</span>
        </div>
        <h1 className="font-serif font-bold text-3xl text-stone-900">
          "{query}" ({pagination.total} results found)
        </h1>
      </div>

      <div className="space-y-6">
        {articles.length > 0 ? (
          articles.map((art) => (
            <div
              key={art.id}
              onClick={() => onSelectArticle(art.slug)}
              className="group cursor-pointer bg-white border border-stone-200 rounded-xl p-6 shadow-xs hover:shadow-md transition-shadow flex flex-col md:flex-row gap-6"
            >
              <div className="w-full md:w-56 aspect-video md:aspect-square rounded-lg overflow-hidden bg-stone-100 shrink-0">
                <img src={art.coverImage} alt={art.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
              </div>
              <div className="flex-1 space-y-3">
                <span className={`${art.category?.color || 'bg-red-700'} text-white text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded shadow-xs`}>
                  {art.category?.name || 'News'}
                </span>
                <h3 className="font-serif font-bold text-xl text-stone-900 group-hover:text-red-700 transition-colors leading-snug">
                  {art.title}
                </h3>
                <p className="text-stone-600 text-sm line-clamp-2">{art.excerpt}</p>
                <div className="flex items-center space-x-4 text-xs text-stone-500 pt-2">
                  <span className="font-semibold text-stone-800">By {art.author?.name || 'Staff'}</span>
                  <span>•</span>
                  <span className="flex items-center space-x-1">
                    <Clock className="w-3.5 h-3.5" />
                    <span>{new Date(art.publishedAt || art.createdAt).toLocaleDateString()}</span>
                  </span>
                </div>
              </div>
            </div>
          ))
        ) : (
          <div className="py-20 text-center text-stone-500 italic">
            No articles found matching your search query. Try searching with different keywords.
          </div>
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center space-x-4 pt-10">
          <button
            disabled={pagination.page === 1}
            onClick={() => setPagination(p => ({ ...p, page: p.page - 1 }))}
            className="p-2 rounded-full hover:bg-stone-100 disabled:opacity-50"
          >
            <ChevronLeft className="w-6 h-6" />
          </button>
          <span className="text-sm font-medium text-stone-900">
            Page {pagination.page} of {totalPages}
          </span>
          <button
            disabled={pagination.page === totalPages}
            onClick={() => setPagination(p => ({ ...p, page: p.page + 1 }))}
            className="p-2 rounded-full hover:bg-stone-100 disabled:opacity-50"
          >
            <ChevronRight className="w-6 h-6" />
          </button>
        </div>
      )}
    </div>
  );
};
