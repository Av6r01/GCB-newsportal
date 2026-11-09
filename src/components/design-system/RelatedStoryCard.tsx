import React from 'react';
import { useLanguage } from '../../context/LanguageContext';
import { ArticleData } from './NewsCard';
import { ArrowUpRight } from 'lucide-react';

export interface RelatedStoryCardProps {
  article: ArticleData;
  onSelectArticle: (slug: string) => void;
}

export const RelatedStoryCard: React.FC<RelatedStoryCardProps> = ({
  article,
  onSelectArticle,
}) => {
  const { lang } = useLanguage();

  const title = lang === 'bn' && article.titleBn ? article.titleBn : article.title;
  const category = article.categoryName || article.categorySlug || 'RELATED';

  return (
    <article
      onClick={() => onSelectArticle(article.slug)}
      className="group cursor-pointer p-3 bg-[#FAF8F5] dark:bg-[#181818] border border-[#E2DDD5] dark:border-[#2A2A2A] hover:border-[#990000] transition-colors flex items-center justify-between gap-3"
    >
      <div className="space-y-1 flex-1">
        <span className="text-[10px] font-bold uppercase tracking-wider text-[#990000]">
          {category}
        </span>
        <h4 className="text-xs sm:text-sm font-bold text-[#1A1A1A] dark:text-[#E5E5E5] group-hover:text-[#990000] transition-colors leading-snug font-display-en">
          {title}
        </h4>
      </div>

      {article.imageUrl && (
        <div className="w-16 h-16 shrink-0 bg-[#EBE6DF] border border-[#E2DDD5] overflow-hidden">
          <img
            src={article.imageUrl}
            alt={title}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform"
            onError={(e) => {
              (e.currentTarget as HTMLElement).style.display = 'none';
            }}
          />
        </div>
      )}
    </article>
  );
};
