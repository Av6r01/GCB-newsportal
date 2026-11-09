import React from 'react';
import { useLanguage } from '../../context/LanguageContext';
import { ArticleData } from './NewsCard';
import { Clock, Calendar, ArrowRight, Flame } from 'lucide-react';

export interface LeadStoryModuleProps {
  leadArticle: ArticleData;
  relatedArticles: ArticleData[];
  onSelectArticle: (slug: string) => void;
}

export const LeadStoryModule: React.FC<LeadStoryModuleProps> = ({
  leadArticle,
  relatedArticles,
  onSelectArticle,
}) => {
  const { lang, t } = useLanguage();

  if (!leadArticle) return null;

  const leadTitle = lang === 'bn' && leadArticle.titleBn ? leadArticle.titleBn : leadArticle.title;
  const leadSummary =
    lang === 'bn' && leadArticle.summaryBn
      ? leadArticle.summaryBn
      : leadArticle.summary || leadArticle.content?.slice(0, 220);
  const category = leadArticle.categoryName || leadArticle.categorySlug || 'GLOBAL DISPATCH';
  const pubDate = new Date(leadArticle.publishedAt || leadArticle.createdAt || Date.now()).toLocaleDateString(
    lang === 'bn' ? 'bn-BD' : 'en-US',
    { month: 'long', day: 'numeric', year: 'numeric' }
  );

  const objectPosition =
    leadArticle.focalX !== undefined && leadArticle.focalX !== null && leadArticle.focalY !== undefined && leadArticle.focalY !== null
      ? `${Math.round(leadArticle.focalX * 100)}% ${Math.round(leadArticle.focalY * 100)}%`
      : 'center';

  return (
    <section className="bg-[#FAF8F5] dark:bg-[#151515] border-b-2 border-[#1A1A1A] dark:border-[#444444] pb-6 mb-6">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
        {/* Left Column: Dominant Lead Article Split (8 cols) */}
        <div
          onClick={() => onSelectArticle(leadArticle.slug)}
          className="lg:col-span-8 cursor-pointer group space-y-4 pr-0 lg:pr-6 lg:border-r border-[#E2DDD5] dark:border-[#2A2A2A]"
        >
          {/* Section Kicker */}
          <div className="flex items-center gap-2 border-b border-[#990000] pb-1">
            <span className="text-xs font-bold uppercase tracking-widest text-[#990000] flex items-center gap-1.5">
              <Flame className="w-3.5 h-3.5 text-[#990000]" />
              {t('hero.lead', 'LEAD DISPATCH')}
            </span>
            <span className="text-xs text-[#666055] font-normal">· {category}</span>
          </div>

          {/* Headline */}
          <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold text-[#1A1A1A] dark:text-[#E5E5E5] group-hover:text-[#990000] transition-colors leading-tight font-display-en">
            {leadTitle}
          </h2>

          {/* Focal Image Container (Zero-CLS aspect-video) */}
          <div className="overflow-hidden bg-[#EBE6DF] dark:bg-[#1F1F1F] border border-[#E2DDD5] dark:border-[#2A2A2A]">
            <div className="aspect-[16/9] relative w-full overflow-hidden">
              {leadArticle.imageUrl ? (
                <img
                  src={leadArticle.imageUrl}
                  alt={leadTitle}
                  referrerPolicy="no-referrer"
                  style={{ objectPosition }}
                  className="w-full h-full object-cover group-hover:scale-102 transition-transform duration-500"
                  onError={(e) => {
                    (e.currentTarget.parentNode as HTMLElement).innerHTML = '';
                  }}
                />
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center">
                  <span className="text-sm font-bold uppercase tracking-widest text-[#990000]">
                    GLOBAL CHRONICLE BUREAU
                  </span>
                  <span className="text-xs text-[#666055] mt-1">{category} · {pubDate}</span>
                </div>
              )}
            </div>
          </div>

          {/* Deck / Summary */}
          {leadSummary && (
            <p className="text-sm sm:text-base text-[#333333] dark:text-[#CCCCCC] leading-relaxed font-body-en">
              {leadSummary}
            </p>
          )}

          {/* Unboxed Byline & Date */}
          <div className="flex items-center justify-between text-xs text-[#666055] dark:text-[#A09A8F] pt-2 border-t border-[#E2DDD5] dark:border-[#2A2A2A]">
            <div>
              By <span className="font-bold text-[#1A1A1A] dark:text-[#E5E5E5]">{leadArticle.authorName || 'Editorial Board'}</span>
              <span> · {pubDate}</span>
            </div>
            <div className="flex items-center gap-1 text-[#990000] font-semibold">
              <span>Read Full Dispatch</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </div>
          </div>
        </div>

        {/* Right Column: High Priority Secondary Dispatches Bullet List (4 cols) */}
        <div className="lg:col-span-4 flex flex-col justify-between space-y-4">
          <div className="border-b border-[#1A1A1A] dark:border-[#444444] pb-1">
            <h3 className="text-xs font-bold uppercase tracking-widest text-[#1B365D] dark:text-amber-300">
              {t('hero.related', 'HIGH PRIORITY DISPATCHES')}
            </h3>
          </div>

          <div className="divide-y divide-[#E2DDD5] dark:divide-[#2A2A2A] flex-1">
            {relatedArticles.slice(0, 4).map((art, idx) => {
              const artTitle = lang === 'bn' && art.titleBn ? art.titleBn : art.title;

              return (
                <article
                  key={art.id || art.slug}
                  onClick={() => onSelectArticle(art.slug)}
                  className="group cursor-pointer py-3 first:pt-0 last:pb-0 hover:bg-[#EBE6DF]/40 transition-colors"
                >
                  <div className="flex items-start gap-3">
                    <span className="text-lg font-bold text-[#990000] font-mono-num leading-none">
                      0{idx + 1}.
                    </span>
                    <div className="space-y-1">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-[#990000]">
                        {art.categoryName || art.categorySlug || 'NEWS'}
                      </span>
                      <h4 className="text-sm font-bold text-[#1A1A1A] dark:text-[#E5E5E5] group-hover:text-[#990000] transition-colors leading-snug font-display-en">
                        {artTitle}
                      </h4>
                      {art.summary && (
                        <p className="text-xs text-[#666055] dark:text-[#888888] line-clamp-2 font-body-en">
                          {art.summary}
                        </p>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
};
