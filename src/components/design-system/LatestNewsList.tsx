import React from 'react';
import { useLanguage } from '../../context/LanguageContext';
import { ArticleData } from './NewsCard';
import { Clock, Radio, ArrowRight } from 'lucide-react';

export interface LatestNewsListProps {
  articles: ArticleData[];
  onSelectArticle: (slug: string) => void;
  onViewAll?: () => void;
}

export const LatestNewsList: React.FC<LatestNewsListProps> = ({
  articles,
  onSelectArticle,
  onViewAll,
}) => {
  const { lang, t } = useLanguage();

  const getTimeAgo = (dateStr?: string) => {
    if (!dateStr) return 'Just now';
    const date = new Date(dateStr);
    const now = new Date();
    const diffMins = Math.floor((now.getTime() - date.getTime()) / (1000 * 60));

    if (diffMins < 60) {
      return lang === 'bn' ? `${diffMins} মি. পূর্বে` : `${diffMins}m ago`;
    }
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) {
      return lang === 'bn' ? `${diffHours} ঘণ্টা পূর্বে` : `${diffHours}h ago`;
    }
    return date.toLocaleDateString(lang === 'bn' ? 'bn-BD' : 'en-US', { month: 'short', day: 'numeric' });
  };

  return (
    <div className="bg-[#FAF8F5] dark:bg-[#151515] border border-[#E2DDD5] dark:border-[#2A2A2A] p-4 flex flex-col justify-between h-full">
      <div className="space-y-3">
        {/* Header */}
        <div className="flex items-center justify-between border-b-2 border-[#1A1A1A] dark:border-[#444444] pb-2">
          <div className="flex items-center gap-2">
            <Radio className="w-4 h-4 text-[#990000] animate-pulse" />
            <h3 className="text-xs font-bold uppercase tracking-widest text-[#1A1A1A] dark:text-[#E5E5E5]">
              {t('latest.title', 'REAL-TIME WIRE')}
            </h3>
          </div>
          <span className="text-[10px] font-mono-num text-[#990000] bg-red-50 dark:bg-red-950/40 px-1.5 py-0.5 rounded font-bold">
            LIVE
          </span>
        </div>

        {/* Vertical Feed */}
        <div className="divide-y divide-[#E2DDD5] dark:divide-[#2A2A2A]">
          {articles.slice(0, 6).map((art) => {
            const title = lang === 'bn' && art.titleBn ? art.titleBn : art.title;

            return (
              <article
                key={art.id || art.slug}
                onClick={() => onSelectArticle(art.slug)}
                className="group cursor-pointer py-2.5 first:pt-0 hover:bg-[#EBE6DF]/50 transition-colors"
              >
                <div className="flex items-center gap-2 text-[11px] text-[#666055] font-mono-num mb-1">
                  <Clock className="w-3 h-3 text-[#990000]" />
                  <span className="font-bold text-[#990000]">{getTimeAgo(art.publishedAt || art.createdAt)}</span>
                  <span>·</span>
                  <span className="uppercase text-[#1B365D] dark:text-amber-300 font-sans-en font-semibold">
                    {art.categoryName || art.categorySlug || 'WIRE'}
                  </span>
                </div>

                <h4 className="text-xs sm:text-sm font-bold text-[#1A1A1A] dark:text-[#E5E5E5] group-hover:text-[#990000] transition-colors leading-snug font-display-en">
                  {title}
                </h4>
              </article>
            );
          })}
        </div>
      </div>

      {/* Footer Action */}
      {onViewAll && (
        <button
          onClick={onViewAll}
          className="mt-4 pt-2 border-t border-[#E2DDD5] dark:border-[#2A2A2A] w-full flex items-center justify-center gap-1.5 text-xs font-bold text-[#1B365D] dark:text-amber-300 hover:text-[#990000] transition-colors uppercase tracking-wider"
        >
          <span>{t('latest.viewAll', 'View Full Wire')}</span>
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
};
