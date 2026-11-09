import React from 'react';
import { useLanguage } from '../../context/LanguageContext';
import { Search } from 'lucide-react';

export interface BrandHeaderProps {
  onOpenSearch?: () => void;
  onHomeClick?: () => void;
}

export const BrandHeader: React.FC<BrandHeaderProps> = ({
  onOpenSearch,
  onHomeClick,
}) => {
  const { lang, t } = useLanguage();

  const getFormattedDate = () => {
    const now = new Date();
    const optionsEn: Intl.DateTimeFormatOptions = {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    };
    const optionsBn: Intl.DateTimeFormatOptions = {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    };

    return lang === 'bn'
      ? now.toLocaleDateString('bn-BD', optionsBn)
      : now.toLocaleDateString('en-US', optionsEn);
  };

  return (
    <header className="border-b border-[#E2DDD5] dark:border-[#2A2A2A] bg-[#FAF8F5] dark:bg-[#121212] pt-4 pb-3 px-4 lg:px-8">
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
        {/* Left Date Lockup */}
        <div className="hidden md:block text-xs text-[#666055] dark:text-[#A09A8F] font-sans-en">
          <div className="font-semibold text-[#1A1A1A] dark:text-[#E5E5E5]">{getFormattedDate()}</div>
          <div>Vol. XCVII No. 34,182 · International Edition</div>
        </div>

        {/* Center Broadsheet Masthead */}
        <div className="text-center cursor-pointer group" onClick={onHomeClick}>
          <h1 className={`text-3xl sm:text-4xl md:text-5xl lg:text-6xl tracking-tight text-[#1A1A1A] dark:text-[#E5E5E5] group-hover:text-[#990000] transition-colors ${
            lang === 'bn' ? 'font-display-bn font-bold' : 'font-display-en font-extrabold uppercase'
          }`}>
            {lang === 'bn' ? 'গ্লোবাল ক্রনিকল ব্যুরো' : 'Global Chronicle Bureau'}
          </h1>
          <div className="flex items-center justify-center gap-2 mt-1 text-xs text-[#666055] dark:text-[#A09A8F] uppercase tracking-widest font-sans-en">
            <span>Dhaka</span>
            <span>·</span>
            <span>London</span>
            <span>·</span>
            <span>New York</span>
            <span>·</span>
            <span>Tokyo</span>
          </div>
        </div>

        {/* Right Search Action */}
        <div className="flex items-center gap-3">
          <button
            onClick={onOpenSearch}
            className="flex items-center gap-2 bg-[#EBE6DF] dark:bg-[#1A1A1A] hover:bg-[#E2DDD5] dark:hover:bg-[#262626] text-[#1A1A1A] dark:text-[#E5E5E5] px-3.5 py-1.5 rounded text-xs font-semibold transition-colors border border-[#D6CEBE] dark:border-[#333333]"
            title={t('nav.search', 'Search Bureau Archive')}
          >
            <Search className="w-3.5 h-3.5 text-[#990000]" />
            <span className="hidden sm:inline">{t('nav.search', 'Search Archive')}</span>
          </button>
        </div>
      </div>
    </header>
  );
};
