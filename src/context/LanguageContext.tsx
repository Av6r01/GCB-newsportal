import React, { createContext, useContext, useState, useEffect } from 'react';

export type Language = 'en' | 'bn';

interface LanguageContextType {
  lang: Language;
  setLang: (lang: Language) => void;
  toggleLang: () => void;
  t: (key: string, fallback?: string) => string;
}

const translations: Record<Language, Record<string, string>> = {
  en: {
    'nav.home': 'Front Page',
    'nav.world': 'World Dispatches',
    'nav.bangladesh': 'Bangladesh',
    'nav.economy': 'Economy & Trade',
    'nav.tech': 'Tech & Innovation',
    'nav.culture': 'Culture & Arts',
    'nav.opinion': 'Editorial & Opinion',
    'nav.search': 'Search Bureau Archive',
    'nav.cms': 'Editorial CMS',
    'nav.login': 'Sign In / Staff Portal',
    'nav.logout': 'Sign Out',
    'banner.breaking': 'BREAKING DISPATCH',
    'banner.live': 'LIVE updates',
    'banner.pause': 'Pause Feed',
    'banner.play': 'Play Feed',
    'hero.lead': 'LEAD DISPATCH',
    'hero.related': 'HIGH PRIORITY DISPATCHES',
    'latest.title': 'REAL-TIME WIRE',
    'latest.viewAll': 'View Full Wire',
    'search.placeholder': 'Search articles, topics, or journalists...',
    'search.filter': 'Filter by Category',
    'search.results': 'Archive Results for',
    'search.noResults': 'No dispatches found matching your search term.',
    'meta.readTime': 'min read',
    'meta.published': 'Published',
    'meta.updated': 'Substantially Updated',
    'meta.by': 'By',
    'meta.location': 'Dhaka Bureau',
    'meta.comments': 'Reader Comments',
    'footer.edition': 'International Edition',
    'footer.motto': 'Independent Journalistic Record Since 1924',
    'footer.policies': 'Editorial Integrity Policy',
    'footer.corrections': 'Corrections & Standards',
    'footer.rights': 'All rights reserved. Global Chronicle Bureau Network.',
  },
  bn: {
    'nav.home': 'প্রচ্ছদ',
    'nav.world': 'আন্তর্জাতিক ডেস্প্যাচ',
    'nav.bangladesh': 'বাংলাদেশ',
    'nav.economy': 'অর্থনীতি ও বাণিজ্য',
    'nav.tech': 'প্রযুক্তি ও উদ্ভাবন',
    'nav.culture': 'সংস্কৃতি ও শিল্প',
    'nav.opinion': 'সম্পাদকীয় ও মতামত',
    'nav.search': 'সংবাদ সংগ্রহশালা খুঁজুন',
    'nav.cms': 'সম্পাদকীয় সিএমএস',
    'nav.login': 'সাইন ইন / স্টাফ পোর্টাল',
    'nav.logout': 'সাইন আউট',
    'banner.breaking': 'জরুরি খবর',
    'banner.live': 'সরাসরি আপডেট',
    'banner.pause': 'ফিড থামান',
    'banner.play': 'ফিড চালু করুন',
    'hero.lead': 'প্রধান সংবাদ',
    'hero.related': 'গুরুত্বপূর্ণ অন্যান্য খবর',
    'latest.title': 'লাইভ নিউজ ওয়ার্যার',
    'latest.viewAll': 'সব খবর দেখুন',
    'search.placeholder': 'নিবন্ধ, বিষয় বা সাংবাদিক খুঁজুন...',
    'search.filter': 'বিভাগ অনুযায়ী ফিল্টার',
    'search.results': 'অনুসন্ধান ফলাফল:',
    'search.noResults': 'আপনার অনুসন্ধানের সাথে মিল থাকা কোনো খবর পাওয়া যায়নি।',
    'meta.readTime': 'মিনিট পাঠ্য',
    'meta.published': 'প্রকাশিত',
    'meta.updated': 'আপডেট করা হয়েছে',
    'meta.by': 'প্রতিবেদন:',
    'meta.location': 'ঢাকা ব্যুরো',
    'meta.comments': 'পাঠকদের মতামত',
    'footer.edition': 'আন্তর্জাতিক সংস্করণ',
    'footer.motto': '১৯২৪ সাল থেকে স্বাধীন সাংবাদিকতার বিশ্বস্ত প্রতীক',
    'footer.policies': 'সম্পাদকীয় নীতিমালা',
    'footer.corrections': 'সংশোধনী ও মানদণ্ড',
    'footer.rights': 'সর্বস্বত্ব সংরক্ষিত। গ্লোবাল ক্রনিকল ব্যুরো নেটওয়ার্ক।',
  },
};

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [lang, setLang] = useState<Language>(() => {
    return (localStorage.getItem('gc_lang') as Language) || 'en';
  });
  // Reader preference set manually this session takes precedence over the
  // configured site default — after any explicit toggle we stop syncing.
  const [userOverrode, setUserOverrode] = useState(false);

  // Phase 10: the configured site default (GET /api/settings →
  // defaultLanguage) seeds the initial switch state for first-time readers.
  // Individual reader choice (stored gc_lang) always wins over the site key.
  useEffect(() => {
    if (localStorage.getItem('gc_lang') || userOverrode) return;
    let cancelled = false;
    fetch('/api/settings')
      .then((res) => (res.ok ? res.json() : {}))
      .then((settings: Record<string, unknown>) => {
        if (cancelled) return;
        const configured = settings?.defaultLanguage;
        if (configured === 'bn' || configured === 'en') {
          setLang((prev) => (prev === configured ? prev : configured));
        }
      })
      .catch(() => {}); // unconfigured or offline → English default stands
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    localStorage.setItem('gc_lang', lang);
    document.documentElement.lang = lang;
  }, [lang]);

  const toggleLang = () => {
    setUserOverrode(true);
    setLang((prev) => (prev === 'en' ? 'bn' : 'en'));
  };

  const setLangOverride = (next: Language) => {
    setUserOverrode(true);
    setLang(next);
  };

  const t = (key: string, fallback?: string): string => {
    return translations[lang]?.[key] || fallback || key;
  };

  return (
    <LanguageContext.Provider value={{ lang, setLang: setLangOverride, toggleLang, t }}>
      {children}
    </LanguageContext.Provider>
  );
};

export const useLanguage = (): LanguageContextType => {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
};
