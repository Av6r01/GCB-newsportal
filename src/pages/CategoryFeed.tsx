import React, { useState, useEffect } from 'react';
import { Clock, ArrowLeft } from 'lucide-react';
import { PageMetadata } from '../components/design-system/PageMetadata';
import { Pagination } from '../components/design-system/Pagination';

interface CategoryFeedProps {
  categorySlug: string;
  onSelectArticle: (slug: string) => void;
  onBack: () => void;
}

export const CategoryFeed: React.FC<CategoryFeedProps> = ({ categorySlug, onSelectArticle, onBack }) => {
  const [articles, setArticles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState({ total: 0, page: 1, limit: 10 });

  const fetchArticles = async (page: number) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/articles?category=${categorySlug}&page=${page}&limit=9`);
      const data = await res.json();
      setArticles(data.articles || []);
      setPagination(data.pagination);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchArticles(1);
  }, [categorySlug]);

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-stone-900"></div>
      </div>
    );
  }

  const totalPages = Math.ceil(pagination.total / pagination.limit);

  return (
    <div className="max-w-7xl mx-auto px-4 md:px-8 py-10 space-y-8">
      <PageMetadata
        title={`${categorySlug.charAt(0).toUpperCase() + categorySlug.slice(1)} Bureau`}
        description={`Latest verified reporting and dispatches from our ${categorySlug} desk.`}
        canonicalPath={`/category/${encodeURIComponent(categorySlug)}`}
      />
      <button
        onClick={onBack}
        className="flex items-center space-x-2 text-stone-600 hover:text-stone-950 font-medium text-sm transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        <span>Return to Home</span>
      </button>

      <div className="border-b border-stone-200 pb-4">
        <h1 className="font-serif font-bold text-3xl md:text-4xl text-stone-900 capitalize">
          {categorySlug} Bureau Feed
        </h1>
        <p className="text-stone-500 text-sm mt-1">
          Latest verified reporting and dispatches from our {categorySlug} desk.
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
            No articles published in this category yet.
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
