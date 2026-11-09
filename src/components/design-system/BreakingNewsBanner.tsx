import React, { useState, useEffect } from 'react';
import { useLanguage } from '../../context/LanguageContext';
import { Flame, Pause, Play, ChevronRight } from 'lucide-react';

export interface BreakingArticle {
  id: string;
  slug: string;
  title: string;
  titleBn?: string;
  category?: string;
  publishedAt?: string;
}

export interface BreakingNewsBannerProps {
  articles: BreakingArticle[];
  onSelectArticle: (slug: string) => void;
}

export const BreakingNewsBanner: React.FC<BreakingNewsBannerProps> = ({
  articles,
  onSelectArticle,
}) => {
  const { lang, t } = useLanguage();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);

  const sampleArticles: BreakingArticle[] = [
    {
      id: 'b1',
      slug: 'global-climate-summit-agrees-on-historic-adaptation-fund',
      title: 'Global Climate Summit Reaches Accord on $100B Loss & Damage Adaptation Mechanism',
      titleBn: 'জলবায়ু সম্মেলনে ১০০ বিলিয়ন ডলারের অভিযোজন তহবিল গঠনে ঐতিহাসিক সমঝোতা',
    },
    {
      id: 'b2',
      slug: 'bangladesh-exports-reach-record-quarterly-high',
      title: 'Bangladesh Trade Ministry Reports Record $14.2B Quarterly Export Volume Driven by Garments & Tech',
      titleBn: 'তৈরি পোশাক ও প্রযুক্তি খাতে ইতিবাচক প্রবৃদ্ধিতে রেকর্ড রপ্তানি আয় অর্জন বাংলাদেশের',
    },
    {
      id: 'b3',
      slug: 'central-banks-announce-coordinated-rate-stability',
      title: 'Central Banks Announce Coordinated Policy Framework to Anchor Inflation Expectations',
      titleBn: 'মুদ্রাস্ফীতি নিয়ন্ত্রণে নতুন আর্থিক নীতিমালা ঘোষণা করল কেন্দ্রীয় ব্যাংকগুলোর জোট',
    },
  ];

  const activeArticles = articles.length > 0 ? articles : sampleArticles;

  useEffect(() => {
    if (isPaused || activeArticles.length <= 1) return;

    const timer = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % activeArticles.length);
    }, 6000);

    return () => clearInterval(timer);
  }, [isPaused, activeArticles.length]);

  const currentArticle = activeArticles[currentIndex] || activeArticles[0];

  return (
    <div className="bg-[#990000] text-white text-xs font-sans-en border-b border-red-900 shadow-inner">
      <div className="max-w-7xl mx-auto flex items-center justify-between px-4 lg:px-8 py-2 gap-4">
        {/* Left Badge */}
        <div className="flex items-center gap-2 shrink-0 font-bold tracking-wider uppercase bg-white/10 px-2.5 py-1 rounded border border-white/20">
          <Flame className="w-3.5 h-3.5 text-amber-300 animate-pulse" />
          <span>{t('banner.breaking', 'BREAKING DISPATCH')}</span>
        </div>

        {/* Center Animated Ticker Text */}
        <div
          onClick={() => currentArticle && onSelectArticle(currentArticle.slug)}
          className="flex-1 cursor-pointer overflow-hidden font-medium text-amber-100 hover:text-white transition-colors truncate"
        >
          <span className="inline-flex items-center gap-2">
            <span className="font-semibold text-white">
              [{currentIndex + 1}/{activeArticles.length}]
            </span>
            <span className="text-sm font-semibold tracking-tight">
              {lang === 'bn' && currentArticle?.titleBn
                ? currentArticle.titleBn
                : currentArticle?.title}
            </span>
            <ChevronRight className="w-3.5 h-3.5 inline text-amber-300 shrink-0" />
          </span>
        </div>

        {/* Right Play/Pause Controls */}
        <button
          onClick={() => setIsPaused(!isPaused)}
          className="shrink-0 p-1 hover:bg-white/10 rounded transition-colors text-amber-200"
          title={isPaused ? t('banner.play', 'Play Feed') : t('banner.pause', 'Pause Feed')}
        >
          {isPaused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
        </button>
      </div>
    </div>
  );
};
