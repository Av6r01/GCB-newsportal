import React from 'react';
import { useLanguage } from '../../context/LanguageContext';
import { Globe, Rss, ShieldCheck, Mail, ChevronRight } from 'lucide-react';
import { pageUrl } from '../../urls';

export interface FooterProps {
  onSelectCategory?: (slug: string) => void;
  onOpenCms?: () => void;
  onOpenAuth?: () => void;
  /** Phase 10: real-path navigation for owned policy/standards pages. */
  onNavigate?: (path: string) => void;
}

export const Footer: React.FC<FooterProps> = ({
  onSelectCategory,
  onOpenCms,
  onNavigate,
}) => {
  const { lang, toggleLang, t } = useLanguage();

  return (
    <footer className="mt-16 bg-[#1A1A1A] text-[#E5E5E5] pt-12 pb-8 border-t-4 border-[#990000] font-sans-en">
      <div className="max-w-7xl mx-auto px-4 lg:px-8">
        {/* Top Masthead Row */}
        <div className="pb-8 mb-8 border-b border-[#333333] flex flex-col md:flex-row items-center justify-between gap-6">
          <div>
            <h2 className="text-3xl font-bold font-display-en uppercase tracking-tight text-white">
              {lang === 'bn' ? 'গ্লোবাল ক্রনিকল ব্যুরো' : 'Global Chronicle Bureau'}
            </h2>
            <p className="text-xs text-[#A09A8F] mt-1">
              {t('footer.motto', 'Independent Journalistic Record Since 1924')} · Dhaka, London, New York, Tokyo
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={toggleLang}
              className="flex items-center gap-2 bg-[#2A2A2A] hover:bg-[#333333] text-amber-300 border border-[#444444] px-3.5 py-1.5 rounded text-xs font-semibold transition-colors"
            >
              <Globe className="w-4 h-4 text-amber-400" />
              <span>{lang === 'en' ? 'বাংলা সংস্করণ' : 'English Edition'}</span>
            </button>
          </div>
        </div>

        {/* 4-Column Directory Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 pb-12 border-b border-[#333333] text-xs">
          {/* Col 1: Section Index */}
          <div className="space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-widest text-[#990000]">
              EDITORIAL SECTIONS
            </h3>
            <ul className="space-y-2 text-[#CCCCCC]">
              <li>
                <button onClick={() => onSelectCategory?.('world')} className="hover:text-white transition-colors">
                  World Dispatches
                </button>
              </li>
              <li>
                <button onClick={() => onSelectCategory?.('bangladesh')} className="hover:text-white transition-colors">
                  Bangladesh Desk
                </button>
              </li>
              <li>
                <button onClick={() => onSelectCategory?.('economy')} className="hover:text-white transition-colors">
                  Economy & Trade
                </button>
              </li>
              <li>
                <button onClick={() => onSelectCategory?.('tech')} className="hover:text-white transition-colors">
                  Technology & Innovation
                </button>
              </li>
              <li>
                <button onClick={() => onSelectCategory?.('opinion')} className="hover:text-white transition-colors">
                  Editorial & Opinion
                </button>
              </li>
            </ul>
          </div>

          {/* Col 2: Standards & Integrity — real owned pages (/page/:slug) */}
          <div className="space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-widest text-[#990000]">
              JOURNALISTIC STANDARDS
            </h3>
            <ul className="space-y-2 text-[#CCCCCC]">
              <li>
                <button onClick={() => onNavigate?.(pageUrl('standards'))} className="hover:text-white transition-colors text-left">
                  {t('footer.policies', 'Editorial Integrity Policy')}
                </button>
              </li>
              <li>
                <button onClick={() => onNavigate?.(pageUrl('standards'))} className="hover:text-white transition-colors text-left">
                  {t('footer.corrections', 'Corrections & Standards')}
                </button>
              </li>
              <li>
                <button onClick={() => onNavigate?.(pageUrl('standards'))} className="hover:text-white transition-colors text-left">
                  Fact-Checking Protocol
                </button>
              </li>
              <li>
                <button onClick={() => onNavigate?.(pageUrl('standards'))} className="hover:text-white transition-colors text-left">
                  Conflict of Interest Disclosures
                </button>
              </li>
              <li>
                <button onClick={() => onNavigate?.(pageUrl('contact'))} className="hover:text-white transition-colors text-left">
                  Anonymous Whistleblower Wire
                </button>
              </li>
              <li>
                <button onClick={() => onNavigate?.(pageUrl('about'))} className="hover:text-white transition-colors text-left">
                  About the Chronicle
                </button>
              </li>
            </ul>
          </div>

          {/* Col 3: Bureau Network — real mailto + contact page */}
          <div className="space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-widest text-[#990000]">
              BUREAU NETWORK
            </h3>
            <div className="space-y-1.5 text-[#A09A8F]">
              <p><strong className="text-white">Dhaka Main Desk:</strong> Kawran Bazar, Dhaka 1215</p>
              <p><strong className="text-white">London Office:</strong> Fleet Street, EC4Y 1AA</p>
              <p><strong className="text-white">New York Bureau:</strong> 8th Ave, NY 10018</p>
              <p className="pt-2 text-amber-300 font-semibold flex items-center gap-1">
                <Mail className="w-3.5 h-3.5" />
                <a href="mailto:newsroom@globalchronicle.org" className="hover:underline">newsroom@globalchronicle.org</a>
              </p>
              <p>
                <button onClick={() => onNavigate?.(pageUrl('contact'))} className="hover:text-white transition-colors underline underline-offset-2">
                  Contact the Newsroom
                </button>
              </p>
            </div>
          </div>

          {/* Col 4: Staff Portal & RSS */}
          <div className="space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-widest text-[#990000]">
              STAFF & RSS FEEDS
            </h3>
            <p className="text-[#A09A8F]">
              Authorized editorial staff may log in to manage dispatches, review queues, and approve revisions.
            </p>

            <div className="space-y-2 pt-1">
              <button
                onClick={onOpenCms}
                className="w-full flex items-center justify-between bg-[#2A2A2A] hover:bg-[#333333] border border-[#444444] px-3 py-2 rounded font-semibold text-amber-300 transition-colors"
              >
                <div className="flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-amber-400" />
                  <span>{t('nav.cms', 'Editorial CMS')}</span>
                </div>
                <ChevronRight className="w-4 h-4" />
              </button>

              <div className="flex items-center gap-2 text-[#A09A8F] pt-2 flex-wrap">
                <Rss className="w-4 h-4 text-amber-400 shrink-0" />
                {/* Phase 9 delivered REAL sitemaps — link them, never a false claim */}
                <a href="/sitemap.xml" className="hover:text-white transition-colors underline underline-offset-2">
                  Regular Sitemap (XML)
                </a>
                <span aria-hidden="true">·</span>
                <a href="/sitemap-news.xml" className="hover:text-white transition-colors underline underline-offset-2">
                  News Sitemap (XML)
                </a>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom Copyright Strip */}
        <div className="pt-6 text-center text-xs text-[#888888] flex flex-col sm:flex-row items-center justify-between gap-4">
          <p>© {new Date().getFullYear()} {t('footer.rights', 'All rights reserved. Global Chronicle Bureau Network.')}</p>
          <p className="flex items-center gap-4">
            <button onClick={() => onNavigate?.(pageUrl('privacy'))} className="hover:text-white transition-colors underline underline-offset-2">
              Privacy
            </button>
            <button onClick={() => onNavigate?.(pageUrl('terms'))} className="hover:text-white transition-colors underline underline-offset-2">
              Terms of Use
            </button>
            <span className="text-[11px] font-mono-num">ISSN 2410-8912 · Verified News Publisher</span>
          </p>
        </div>
      </div>
    </footer>
  );
};
