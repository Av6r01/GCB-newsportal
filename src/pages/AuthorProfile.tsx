import React, { useState, useEffect } from 'react';
import { Clock, ArrowLeft } from 'lucide-react';
import { PageMetadata } from '../components/design-system/PageMetadata';
import { Pagination } from '../components/design-system/Pagination';
import { NewsCard } from '../components/design-system/NewsCard';

interface AuthorProfileProps {
  authorId: string;
  onSelectArticle: (slug: string) => void;
  onBack: () => void;
}

export const AuthorProfile: React.FC<AuthorProfileProps> = ({ authorId, onSelectArticle, onBack }) => {
  const [author, setAuthor] = useState<any>(null);
  const [articles, setArticles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState({ total: 0, page: 1, limit: 10 });

  const fetchAuthorData = async (page: number) => {
    setLoading(true);
    try {
      // Fetch author profile
      const profRes = await fetch(`/api/authors/${authorId}`);
      const profData = await profRes.json();
      setAuthor(profData);
      
      // Fetch paginated articles
      const artRes = await fetch(`/api/articles?authorId=${authorId}&page=${page}&limit=9`);
      const artData = await artRes.json();
      setArticles(artData.articles || []);
      setPagination(artData.pagination);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAuthorData(1);
  }, [authorId]);

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
        title={`Author: ${author?.user?.name || 'Author Profile'}`}
        description={`Articles by ${author?.user?.name || 'this journalist'}.`}
        canonicalPath={`/author/${encodeURIComponent(authorId)}`}
      />
      <button
        onClick={onBack}
        className="flex items-center space-x-2 text-stone-600 hover:text-stone-950 font-medium text-sm transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        <span>Return to Home</span>
      </button>

      <div className="bg-stone-50 border border-stone-200 p-8 rounded-xl space-y-4">
        <div className="flex items-center gap-6">
          <img src={author?.user?.avatar || '/default-avatar.png'} alt={author?.user?.name} className="w-24 h-24 rounded-full bg-stone-200 object-cover" />
          <div>
            <h1 className="font-serif font-bold text-3xl text-stone-900">{author?.user?.name}</h1>
            <p className="text-stone-700 font-semibold">{author?.profile?.designation}</p>
            <p className="text-stone-600 text-sm mt-2 max-w-2xl">{author?.profile?.biography}</p>
          </div>
        </div>
      </div>

      <div className="border-b border-stone-200 pb-4">
        <h2 className="font-serif font-bold text-2xl text-stone-900">Articles by {author?.user?.name}</h2>
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
            This journalist has not published any articles.
          </div>
        )}
      </div>

      <Pagination 
        currentPage={pagination.page} 
        totalPages={totalPages} 
        onPageChange={fetchAuthorData} 
      />
    </div>
  );
};
