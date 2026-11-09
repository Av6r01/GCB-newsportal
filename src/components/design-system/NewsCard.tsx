import React from 'react';
import { useLanguage } from '../../context/LanguageContext';
import { Clock, Calendar, MessageSquare, ArrowUpRight } from 'lucide-react';

export interface ArticleData {
  id: string;
  slug: string;
  title: string;
  titleBn?: string;
  summary?: string;
  summaryBn?: string;
  content?: string;
  categoryName?: string;
  categorySlug?: string;
  authorName?: string;
  publishedAt?: string;
  createdAt?: string;
  imageUrl?: string | null;
  focalX?: number | null;
  focalY?: number | null;
  commentsCount?: number;
  readTimeMinutes?: number;
}

export interface NewsCardProps {
  article: ArticleData;
  layout?: 'vertical' | 'horizontal' | 'compact' | 'headline-only';
  aspectRatio?: 'aspect-[16/9]' | 'aspect-[4/3]' | 'aspect-square';
  onSelectArticle: (slug: string) => void;
  showSummary?: boolean;
}

export const NewsCard: React.FC<NewsCardProps> = ({
  article,
  layout = 'vertical',
  aspectRatio = 'aspect-[16/9]',
  onSelectArticle,
  showSummary = true,
}) => {
  const { lang } = useLanguage();

  const title = lang === 'bn' && article.titleBn ? article.titleBn : article.title;
  const summary = lang === 'bn' && article.summaryBn ? article.summaryBn : (article.summary || article.content?.slice(0, 140));
  const category = article.categoryName || article.categorySlug || 'DISPATCH';
  const pubDate = new Date(article.publishedAt || article.createdAt || Date.now()).toLocaleDateString(
    lang === 'bn' ? 'bn-BD' : 'en-US',
    { month: 'short', day: 'numeric', year: 'numeric' }
  );

  // Compute focal point object position
  const objectPosition =
    article.focalX !== undefined && article.focalX !== null && article.focalY !== undefined && article.focalY !== null
      ? `${Math.round(article.focalX * 100)}% ${Math.round(article.focalY * 100)}%`
      : 'center';

  // Fallback SVG mesh container when image is missing or errors out
  const defaultImage = (
    <div className="w-full h-full bg-[#EBE6DF] dark:bg-[#1F1F1F] flex flex-col items-center justify-center p-4 text-center border border-[#E2DDD5] dark:border-[#333333]">
      <span className="text-xs font-bold uppercase tracking-widest text-[#990000] mb-1">
        GLOBAL CHRONICLE BUREAU
      </span>
      <span className="text-[10px] text-[#666055] dark:text-[#888888]">
        {category} · {pubDate}
      </span>
    </div>
  );

  if (layout === 'headline-only') {
    return (
      <div
        onClick={() => onSelectArticle(article.slug)}
        className="group cursor-pointer py-2 border-b border-[#E2DDD5] dark:border-[#2A2A2A] hover:bg-[#EBE6DF]/40 transition-colors"
      >
        <div className="flex items-center gap-2 text-[11px] text-[#990000] font-semibold uppercase tracking-wider mb-1">
          <span>{category}</span>
          <span className="text-[#666055]">·</span>
          <span className="text-[#666055] font-normal">{pubDate}</span>
        </div>
        <h4 className="text-sm font-bold text-[#1A1A1A] dark:text-[#E5E5E5] group-hover:text-[#990000] transition-colors leading-snug font-display-en">
          {title}
        </h4>
      </div>
    );
  }

  if (layout === 'horizontal') {
    return (
      <article
        onClick={() => onSelectArticle(article.slug)}
        className="group cursor-pointer py-3 border-b border-[#E2DDD5] dark:border-[#2A2A2A] hover:bg-[#EBE6DF]/40 transition-colors grid grid-cols-1 sm:grid-cols-12 gap-4 items-center"
      >
        {/* Aspect Ratio Image Wrapper */}
        <div className="sm:col-span-4 overflow-hidden bg-[#EBE6DF] dark:bg-[#1A1A1A] border border-[#E2DDD5] dark:border-[#2A2A2A]">
          <div className={`${aspectRatio} relative w-full overflow-hidden`}>
            {article.imageUrl ? (
              <img
                src={article.imageUrl}
                alt={title}
                referrerPolicy="no-referrer"
                style={{ objectPosition }}
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                onError={(e) => {
                  (e.currentTarget.parentNode as HTMLElement).innerHTML = '';
                }}
              />
            ) : (
              defaultImage
            )}
          </div>
        </div>

        {/* Article Details */}
        <div className="sm:col-span-8 space-y-1.5">
          {/* Zero-Pill Unboxed Quiet Metadata */}
          <div className="flex items-center gap-2 text-xs text-[#666055] dark:text-[#A09A8F]">
            <span className="font-bold text-[#990000] uppercase tracking-wider">{category}</span>
            <span>·</span>
            <span>{pubDate}</span>
            {article.readTimeMinutes && (
              <>
                <span>·</span>
                <span>{article.readTimeMinutes} min read</span>
              </>
            )}
          </div>

          <h3 className="text-lg font-bold text-[#1A1A1A] dark:text-[#E5E5E5] group-hover:text-[#990000] transition-colors leading-snug font-display-en">
            {title}
          </h3>

          {showSummary && summary && (
            <p className="text-xs text-[#666055] dark:text-[#A09A8F] line-clamp-2 font-body-en">
              {summary}
            </p>
          )}

          {article.authorName && (
            <div className="text-[11px] text-[#666055] dark:text-[#888888] font-sans-en pt-0.5">
              By <span className="font-semibold text-[#1A1A1A] dark:text-[#CCCCCC]">{article.authorName}</span>
            </div>
          )}
        </div>
      </article>
    );
  }

  // Default Vertical Card Layout
  return (
    <article
      onClick={() => onSelectArticle(article.slug)}
      className="group cursor-pointer flex flex-col justify-between h-full p-3 bg-[#FAF8F5] dark:bg-[#181818] border border-[#E2DDD5] dark:border-[#2A2A2A] hover:border-[#990000] hover:shadow-md transition-all"
    >
      <div className="space-y-2">
        {/* Aspect Ratio Image Container */}
        <div className="overflow-hidden bg-[#EBE6DF] dark:bg-[#1A1A1A] border border-[#E2DDD5] dark:border-[#2A2A2A] mb-2">
          <div className={`${aspectRatio} relative w-full overflow-hidden`}>
            {article.imageUrl ? (
              <img
                src={article.imageUrl}
                alt={title}
                referrerPolicy="no-referrer"
                style={{ objectPosition }}
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                onError={(e) => {
                  (e.currentTarget.parentNode as HTMLElement).innerHTML = '';
                }}
              />
            ) : (
              defaultImage
            )}
          </div>
        </div>

        {/* Unboxed Metadata (Zero Pill Enclosure) */}
        <div className="flex items-center gap-2 text-xs text-[#666055] dark:text-[#A09A8F]">
          <span className="font-bold text-[#990000] uppercase tracking-wider">{category}</span>
          <span>·</span>
          <span>{pubDate}</span>
        </div>

        <h3 className="text-base sm:text-lg font-bold text-[#1A1A1A] dark:text-[#E5E5E5] group-hover:text-[#990000] transition-colors leading-tight font-display-en">
          {title}
        </h3>

        {showSummary && summary && (
          <p className="text-xs text-[#666055] dark:text-[#A09A8F] line-clamp-3 font-body-en leading-relaxed">
            {summary}
          </p>
        )}
      </div>

      {/* Card Footer Byline */}
      <div className="pt-3 mt-3 border-t border-[#E2DDD5] dark:border-[#2A2A2A] flex items-center justify-between text-[11px] text-[#666055]">
        {article.authorName ? (
          <span>By <strong className="text-[#1A1A1A] dark:text-[#E5E5E5]">{article.authorName}</strong></span>
        ) : (
          <span>Global Bureau</span>
        )}

        <div className="flex items-center gap-2 text-[#990000]">
          <ArrowUpRight className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity" />
        </div>
      </div>
    </article>
  );
};
