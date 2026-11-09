import React, { useState, useEffect } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useLanguage } from '../../context/LanguageContext';
import { Search, X, Loader2, Calendar, ArrowRight } from 'lucide-react';
import { dialogVariant } from '../../motionTokens';

export interface SearchInterfaceProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectArticle: (slug: string) => void;
}

export const SearchInterface: React.FC<SearchInterfaceProps> = ({
  isOpen,
  onClose,
  onSelectArticle,
}) => {
  const { lang, t } = useLanguage();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      setLoading(false);
      return;
    }

    const timer = setTimeout(() => {
      setLoading(true);
      fetch(`/api/articles/search?q=${encodeURIComponent(query.trim())}`)
        .then((res) => res.json())
        .then((data) => {
          if (Array.isArray(data)) setResults(data);
          else setResults([]);
        })
        .catch(() => setResults([]))
        .finally(() => setLoading(false));
    }, 300);

    return () => clearTimeout(timer);
  }, [query]);

  const filteredResults = selectedCategory === 'all'
    ? results
    : results.filter((r) => r.categorySlug === selectedCategory || r.category === selectedCategory);

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-12 sm:pt-20 px-4">
          {/* Backdrop */}
          <motion.div
            className="fixed inset-0 bg-black/70 backdrop-blur-xs"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
          />

          {/* Modal Container — slides down from top */}
          <motion.div
            className="relative w-full max-w-3xl bg-[#FAF8F5] dark:bg-[#1A1A1A] text-[#1A1A1A] dark:text-[#E5E5E5] rounded-none shadow-2xl border border-[#E2DDD5] dark:border-[#333333] flex flex-col max-h-[85vh] z-10 overflow-hidden"
            variants={dialogVariant}
            initial="hidden"
            animate="visible"
            exit="exit"
            role="dialog"
            aria-modal="true"
            aria-label="Search"
          >
            {/* Header Search Box */}
            <div className="p-4 sm:p-6 border-b border-[#E2DDD5] dark:border-[#333333] bg-[#EBE6DF] dark:bg-[#121212]">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-bold uppercase tracking-widest text-[#990000]">
                  {t('nav.search', 'Search Bureau Archive')}
                </span>
                <button
                  onClick={onClose}
                  className="p-2 text-[#666055] hover:text-[#1A1A1A] dark:hover:text-white transition-colors focus-visible:outline-2 focus-visible:outline-[#990000]"
                  aria-label="Close search"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="relative">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-[#990000]" />
                <input
                  type="text"
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t('search.placeholder', 'Search articles, topics, or journalists...')}
                  className="w-full pl-11 pr-10 py-3 bg-white dark:bg-[#222222] border border-[#D6CEBE] dark:border-[#444444] text-[#1A1A1A] dark:text-[#E5E5E5] text-base focus:outline-none focus:border-[#990000] font-sans-en"
                />
                {loading && (
                  <Loader2 className="absolute right-3.5 top-1/2 -translate-y-1/2 w-5 h-5 animate-spin text-[#990000]" />
                )}
              </div>

              {/* Interactive Category Filter Buttons */}
              <div className="flex items-center gap-2 mt-3 overflow-x-auto scrollbar-hide">
                {['all', 'world', 'bangladesh', 'economy', 'tech', 'opinion'].map((cat) => (
                  <button
                    key={cat}
                    onClick={() => setSelectedCategory(cat)}
                    className={`px-3 py-1 text-xs font-medium uppercase tracking-wider whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-[#990000] ${
                      selectedCategory === cat
                        ? 'bg-[#1B365D] text-white font-bold'
                        : 'bg-white dark:bg-[#222222] text-[#666055] dark:text-[#CCCCCC] border border-[#E2DDD5] dark:border-[#333333] hover:text-[#1A1A1A]'
                    }`}
                  >
                    {cat === 'all' ? 'All Sections' : cat}
                  </button>
                ))}
              </div>
            </div>

            {/* Search Results Feed */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
              {!query.trim() && (
                <div className="text-center py-12 text-[#666055] dark:text-[#A09A8F]">
                  <Search className="w-10 h-10 mx-auto mb-3 opacity-30 text-[#990000]" />
                  <p className="text-sm font-sans-en">
                    Enter keywords above to search dispatches across Dhaka, London, and international bureaus.
                  </p>
                </div>
              )}

              {query.trim() && !loading && filteredResults.length === 0 && (
                <div className="text-center py-12 text-[#666055] dark:text-[#A09A8F]">
                  <p className="text-base font-semibold text-[#1A1A1A] dark:text-[#E5E5E5]">
                    {t('search.noResults', 'No dispatches found matching your search term.')}
                  </p>
                  <p className="text-xs mt-1">Try broadening your search term or checking spelling.</p>
                </div>
              )}

              {filteredResults.map((article) => (
                <article
                  key={article.id}
                  onClick={() => {
                    onSelectArticle(article.slug);
                    onClose();
                  }}
                  className="group cursor-pointer p-3 border-b border-[#E2DDD5] dark:border-[#2A2A2A] hover:bg-[#EBE6DF]/60 dark:hover:bg-[#222222] transition-colors flex items-start justify-between gap-4 focus-visible:outline-2 focus-visible:outline-[#990000]"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter') { onSelectArticle(article.slug); onClose(); } }}
                  role="button"
                >
                  <div className="space-y-1 flex-1">
                    <div className="flex items-center gap-2 text-xs text-[#990000] font-semibold uppercase tracking-wider">
                      <span>{article.categoryName || article.categorySlug || 'DISPATCH'}</span>
                      <span className="text-[#666055]">·</span>
                      <span className="text-[#666055] normal-case font-normal flex items-center gap-1">
                        <Calendar className="w-3 h-3 inline" />
                        {new Date(article.publishedAt || article.createdAt || Date.now()).toLocaleDateString()}
                      </span>
                    </div>

                    <h3 className="text-base font-bold text-[#1A1A1A] dark:text-[#E5E5E5] group-hover:text-[#990000] transition-colors font-display-en leading-tight">
                      {lang === 'bn' && article.titleBn ? article.titleBn : article.title}
                    </h3>

                    <p className="text-xs text-[#666055] dark:text-[#A09A8F] line-clamp-2 font-body-en">
                      {article.summary || article.content?.slice(0, 120)}
                    </p>
                  </div>

                  <div className="shrink-0 self-center text-[#990000] opacity-0 group-hover:opacity-100 transition-opacity">
                    <ArrowRight className="w-5 h-5" />
                  </div>
                </article>
              ))}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
