import React from 'react';
import { useLanguage } from '../../context/LanguageContext';
import { Menu, Search, Flame } from 'lucide-react';

export interface Category {
  id: string;
  slug: string;
  name: string;
  nameBn?: string;
}

export interface DesktopNavProps {
  categories: Category[];
  currentCategorySlug?: string | null;
  onSelectCategory: (slug: string | null) => void;
  onOpenMobileMenu?: () => void;
  onOpenSearch?: () => void;
}

export const DesktopNav: React.FC<DesktopNavProps> = ({
  categories,
  currentCategorySlug,
  onSelectCategory,
  onOpenMobileMenu,
  onOpenSearch,
}) => {
  const { lang, t } = useLanguage();

  const defaultCategories: Category[] = [
    { id: 'world', slug: 'world', name: 'World Dispatches', nameBn: 'আন্তর্জাতিক' },
    { id: 'bangladesh', slug: 'bangladesh', name: 'Bangladesh', nameBn: 'বাংলাদেশ' },
    { id: 'economy', slug: 'economy', name: 'Economy & Trade', nameBn: 'অর্থনীতি' },
    { id: 'tech', slug: 'tech', name: 'Tech & Science', nameBn: 'প্রযুক্তি' },
    { id: 'culture', slug: 'culture', name: 'Culture & Arts', nameBn: 'সংস্কৃতি' },
    { id: 'opinion', slug: 'opinion', name: 'Editorial', nameBn: 'সম্পাদকীয়' },
  ];

  const activeCategoryList = categories.length > 0 ? categories : defaultCategories;

  return (
    <nav className="sticky top-0 z-30 border-b border-[#E2DDD5] dark:border-[#2A2A2A] bg-[#FAF8F5]/95 dark:bg-[#121212]/95 backdrop-blur-sm px-4 lg:px-8 shadow-sm">
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-8 h-12">
        {/* Mobile Hamburger Toggle */}
        <button
          onClick={onOpenMobileMenu}
          className="lg:hidden p-1.5 text-[#1A1A1A] dark:text-[#E5E5E5] hover:bg-[#EBE6DF] dark:hover:bg-[#222222] rounded transition-colors"
          aria-label="Toggle navigation drawer"
        >
          <Menu className="w-5 h-5" />
        </button>

        {/* Home / Front Page Trigger */}
        <button
          onClick={() => onSelectCategory(null)}
          className={`whitespace-nowrap shrink-0 text-sm font-bold uppercase tracking-wider transition-colors hover:text-[#990000] ${
            !currentCategorySlug
              ? 'text-[#990000] border-b-2 border-[#990000] py-3'
              : 'text-[#1A1A1A] dark:text-[#E5E5E5]'
          }`}
        >
          {t('nav.home', 'Front Page')}
        </button>

        {/* Primary Navigation Links (Single-Line, 4-6 links) */}
        <div className="hidden lg:flex items-center gap-6 overflow-x-auto no-scrollbar">
          {activeCategoryList.slice(0, 6).map((cat) => {
            const isSelected = currentCategorySlug === cat.slug;
            const displayName = lang === 'bn' && cat.nameBn ? cat.nameBn : cat.name;

            return (
              <button
                key={cat.id || cat.slug}
                onClick={() => onSelectCategory(cat.slug)}
                className={`whitespace-nowrap shrink-0 text-sm font-medium transition-colors hover:text-[#990000] py-3 ${
                  isSelected
                    ? 'text-[#990000] font-bold border-b-2 border-[#990000]'
                    : 'text-[#333333] dark:text-[#CCCCCC]'
                }`}
              >
                {displayName}
              </button>
            );
          })}
        </div>

        {/* Live Indicator & Search Quick Action */}
        <div className="flex items-center gap-3 shrink-0">
          <div className="hidden sm:flex items-center gap-1.5 text-xs font-semibold text-[#990000] bg-red-50 dark:bg-red-950/40 px-2.5 py-1 rounded border border-red-200 dark:border-red-900/60">
            <Flame className="w-3.5 h-3.5 animate-pulse" />
            <span className="whitespace-nowrap uppercase tracking-wide">
              {t('banner.live', 'Live Wire')}
            </span>
          </div>

          <button
            onClick={onOpenSearch}
            className="p-1.5 text-[#1A1A1A] dark:text-[#E5E5E5] hover:bg-[#EBE6DF] dark:hover:bg-[#222222] rounded transition-colors"
            title="Search"
          >
            <Search className="w-4 h-4" />
          </button>
        </div>
      </div>
    </nav>
  );
};
