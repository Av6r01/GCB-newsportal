import React, { useEffect, useState } from 'react';

interface RelatedStoriesProps {
  articleId: string;
  tags: string[];
  categoryId: string;
}

export const RelatedStories: React.FC<RelatedStoriesProps> = ({ articleId, tags, categoryId }) => {
  const [related, setRelated] = useState<any[]>([]);

  useEffect(() => {
    // Simple fetch based on tags/category
    const query = new URLSearchParams({
      limit: '3',
      exclude: articleId,
      ...(tags.length > 0 ? { tags: tags.join(',') } : {}),
      ...(categoryId ? { category: categoryId } : {})
    });
    
    fetch(`/api/articles?${query.toString()}`)
      .then((res) => res.json())
      .then((data) => setRelated(data.articles || []))
      .catch(() => setRelated([]));
  }, [articleId, tags, categoryId]);

  if (related.length === 0) return null;

  return (
    <div className="my-10 border-t border-stone-200 pt-8">
      <h3 className="font-serif font-bold text-xl text-stone-900 mb-6">Related Stories</h3>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {related.map((article) => (
          <a key={article.id} href={`/article/${article.slug}`} className="space-y-2 block group">
            <img src={article.coverImage} alt={article.title} className="w-full h-40 object-cover rounded" />
            <h4 className="font-bold text-stone-900 text-sm group-hover:text-red-700 leading-tight">{article.title}</h4>
          </a>
        ))}
      </div>
    </div>
  );
};
