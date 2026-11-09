import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useLanguage } from '../../context/LanguageContext';
import { Category } from './DesktopNav';
import { X, Globe, Search, Home, Shield, User } from 'lucide-react';
import { drawerVariant } from '../../motionTokens';

export interface MobileNavProps {
  isOpen: boolean;
  onClose: () => void;
  categories: Category[];
  currentCategorySlug?: string | null;
  onSelectCategory: (slug: string | null) => void;
  onOpenSearch?: () => void;
  user?: any;
  onOpenAuth?: () => void;
  onOpenCms?: () => void;
  onLogout?: () => void;
}

export const MobileNav: React.FC<MobileNavProps> = ({
  isOpen,
  onClose,
  categories,
  currentCategorySlug,
  onSelectCategory,
  onOpenSearch,
  user,
  onOpenAuth,
  onOpenCms,
  onLogout,
}) => {
  const { lang, toggleLang, t } = useLanguage();

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex">
          {/* Dark Backdrop — fades in/out */}
          <motion.div
            className="fixed inset-0 bg-black/60 backdrop-blur-xs"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
          />

          {/* Drawer Body — slides in from left */}
          <motion.div
            className="relative w-4/5 max-w-sm bg-[#FAF8F5] dark:bg-[#181818] text-[#1A1A1A] dark:text-[#E5E5E5] h-full shadow-2xl flex flex-col z-10 border-r border-[#E2DDD5] dark:border-[#2A2A2A]"
            variants={drawerVariant}
            initial="hidden"
            animate="visible"
            exit="exit"
          >
            {/* Drawer Header */}
            <div className="p-4 border-b border-[#E2DDD5] dark:border-[#2A2A2A] flex items-center justify-between bg-[#EBE6DF] dark:bg-[#121212]">
              <span className="font-display-en font-bold text-lg text-[#1A1A1A] dark:text-[#E5E5E5]">
                {lang === 'bn' ? 'গ্লোবাল ক্রনিকল' : 'Global Chronicle'}
              </span>
              <button
                onClick={onClose}
                className="p-2 rounded text-[#666055] hover:text-[#1A1A1A] dark:hover:text-white transition-colors focus-visible:outline-2 focus-visible:outline-[#990000]"
                aria-label="Close navigation menu"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Drawer Search & Language Bar */}
            <div className="p-4 border-b border-[#E2DDD5] dark:border-[#2A2A2A] space-y-3">
              <button
                onClick={() => {
                  onClose();
                  onOpenSearch?.();
                }}
                className="w-full flex items-center gap-2 bg-white dark:bg-[#222222] border border-[#E2DDD5] dark:border-[#333333] px-3 py-2.5 rounded text-sm text-[#666055] dark:text-[#A09A8F] focus-visible:outline-2 focus-visible:outline-[#990000]"
                aria-label="Open search"
              >
                <Search className="w-4 h-4 text-[#990000]" />
                <span>{t('search.placeholder', 'Search articles...')}</span>
              </button>

              <button
                onClick={toggleLang}
                className="w-full flex items-center justify-between bg-[#1B365D] text-white px-3 py-2.5 rounded text-xs font-semibold focus-visible:outline-2 focus-visible:outline-amber-300"
                aria-label="Switch language"
              >
                <div className="flex items-center gap-2">
                  <Globe className="w-4 h-4 text-amber-300" />
                  <span>{lang === 'en' ? 'বাংলা সংস্করণ' : 'English Edition'}</span>
                </div>
                <span className="text-amber-300 text-xs uppercase">Switch</span>
              </button>
            </div>

            {/* Category List */}
            <nav className="flex-1 overflow-y-auto p-4 space-y-1" aria-label="Site navigation">
              <button
                onClick={() => {
                  onSelectCategory(null);
                  onClose();
                }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-[#990000] ${
                  !currentCategorySlug
                    ? 'bg-[#990000] text-white'
                    : 'hover:bg-[#EBE6DF] dark:hover:bg-[#222222]'
                }`}
              >
                <Home className="w-4 h-4" />
                <span>{t('nav.home', 'Front Page')}</span>
              </button>

              {categories.map((cat) => {
                const isSelected = currentCategorySlug === cat.slug;
                const displayName = lang === 'bn' && cat.nameBn ? cat.nameBn : cat.name;

                return (
                  <button
                    key={cat.id || cat.slug}
                    onClick={() => {
                      onSelectCategory(cat.slug);
                      onClose();
                    }}
                    className={`w-full text-left px-3 py-2.5 rounded text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-[#990000] ${
                      isSelected
                        ? 'bg-[#990000] text-white font-bold'
                        : 'hover:bg-[#EBE6DF] dark:hover:bg-[#222222] text-[#333333] dark:text-[#CCCCCC]'
                    }`}
                  >
                    {displayName}
                  </button>
                );
              })}
            </nav>

            {/* Drawer Footer Auth */}
            <div className="p-4 border-t border-[#E2DDD5] dark:border-[#2A2A2A] bg-[#EBE6DF] dark:bg-[#121212]">
              {user ? (
                <div className="space-y-2">
                  <button
                    onClick={() => {
                      onClose();
                      onOpenCms?.();
                    }}
                    className="w-full flex items-center gap-2 bg-[#990000] text-white px-3 py-2.5 rounded text-xs font-bold justify-center focus-visible:outline-2 focus-visible:outline-white"
                  >
                    <Shield className="w-4 h-4" />
                    <span>{t('nav.cms', 'Editorial CMS')}</span>
                  </button>
                  <button
                    onClick={() => {
                      onLogout?.();
                      onClose();
                    }}
                    className="w-full text-center text-xs text-[#666055] hover:text-[#990000] py-1 focus-visible:outline-2 focus-visible:outline-[#990000]"
                  >
                    {t('nav.logout', 'Sign Out')}
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => {
                    onClose();
                    onOpenAuth?.();
                  }}
                  className="w-full flex items-center justify-center gap-2 border border-[#1B365D] text-[#1B365D] dark:text-amber-300 dark:border-amber-300 px-3 py-2.5 rounded text-xs font-bold focus-visible:outline-2 focus-visible:outline-[#1B365D]"
                >
                  <User className="w-4 h-4" />
                  <span>{t('nav.login', 'Sign In / Staff Portal')}</span>
                </button>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
