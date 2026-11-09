import React from 'react';
import { useLanguage } from '../../context/LanguageContext';
import { ArrowRight, Rss } from 'lucide-react';

export interface CategoryHeadingProps {
  title: string;
  titleBn?: string;
  subtitle?: string;
  onViewAll?: () => void;
}

export const CategoryHeading: React.FC<CategoryHeadingProps> = ({
  title,
  titleBn,
  subtitle,
  onViewAll,
}) => {
  const { lang } = useLanguage();
  const displayTitle = lang === 'bn' && titleBn ? titleBn : title;

  return (
    <div className="border-double-hairline pb-2 mb-6 flex flex-col sm:flex-row sm:items-end justify-between gap-2">
      <div>
        <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-[#990000]">
          <span>SECTION DISPATCHES</span>
        </div>
        <h2 className="text-xl sm:text-2xl font-bold text-[#1A1A1A] dark:text-[#E5E5E5] font-display-en tracking-tight">
          {displayTitle}
        </h2>
        {subtitle && (
          <p className="text-xs text-[#666055] dark:text-[#A09A8F] font-body-en">{subtitle}</p>
        )}
      </div>

      {onViewAll && (
        <button
          onClick={onViewAll}
          className="flex items-center gap-1.5 text-xs font-bold text-[#1B365D] dark:text-amber-300 hover:text-[#990000] transition-colors uppercase tracking-wider shrink-0"
        >
          <span>View Section</span>
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
};
