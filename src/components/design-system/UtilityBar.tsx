import React, { useState, useEffect } from 'react';
import { useLanguage } from '../../context/LanguageContext';
import { Globe, Clock, CloudSun, User, Shield } from 'lucide-react';

export interface UtilityBarProps {
  user?: any;
  onOpenAuth?: () => void;
  onOpenCms?: () => void;
  onLogout?: () => void;
}

export const UtilityBar: React.FC<UtilityBarProps> = ({
  user,
  onOpenAuth,
  onOpenCms,
  onLogout,
}) => {
  const { lang, toggleLang, t } = useLanguage();
  const [timeStr, setTimeStr] = useState('');

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      const options: Intl.DateTimeFormatOptions = {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZoneName: 'short',
      };
      setTimeStr(now.toLocaleDateString(lang === 'bn' ? 'bn-BD' : 'en-US', options));
    };

    updateTime();
    const interval = setInterval(updateTime, 10000);
    return () => clearInterval(interval);
  }, [lang]);

  return (
    <div className="bg-[#1B365D] text-white text-xs py-1.5 px-4 lg:px-8 border-b border-[#0F2342] font-sans-en">
      <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2">
        {/* Left: Operational Metadata & Live Time */}
        <div className="flex items-center gap-4 text-slate-200">
          <div className="flex items-center gap-1.5 font-mono-num">
            <Clock className="w-3.5 h-3.5 text-amber-400" />
            <span>{timeStr || 'BST (Dhaka) / GMT+6'}</span>
          </div>
          <span className="hidden md:inline text-slate-400">·</span>
          <div className="hidden md:flex items-center gap-1.5 text-slate-300">
            <CloudSun className="w-3.5 h-3.5 text-amber-300" />
            <span>Dhaka 28°C Hazy Sun</span>
          </div>
          <span className="hidden lg:inline text-slate-400">·</span>
          <span className="hidden lg:inline font-medium tracking-wide text-amber-200">
            {t('footer.motto', 'Independent Journalistic Record Since 1924')}
          </span>
        </div>

        {/* Right: Language Switcher, Staff Portal & Auth Controls */}
        <div className="flex items-center gap-4 shrink-0">
          {/* Script / Language Switcher */}
          <button
            onClick={toggleLang}
            className="flex items-center gap-1.5 bg-white/10 hover:bg-white/20 px-2.5 py-0.5 rounded text-xs font-semibold text-white transition-colors border border-white/20"
            title="Switch Language / ভাষা পরিবর্তন করুন"
          >
            <Globe className="w-3.5 h-3.5 text-amber-300" />
            <span>{lang === 'en' ? 'বাংলা সংস্করণ' : 'English Edition'}</span>
          </button>

          <span className="text-slate-400">|</span>

          {/* User Auth or CMS Switcher */}
          {user ? (
            <div className="flex items-center gap-3">
              <button
                onClick={onOpenCms}
                className="flex items-center gap-1.5 text-amber-300 hover:text-amber-200 font-semibold transition-colors"
              >
                <Shield className="w-3.5 h-3.5" />
                <span>{t('nav.cms', 'Editorial CMS')}</span>
              </button>
              <button
                onClick={onLogout}
                className="text-slate-300 hover:text-white transition-colors"
              >
                {t('nav.logout', 'Sign Out')}
              </button>
            </div>
          ) : (
            <button
              onClick={onOpenAuth}
              className="flex items-center gap-1 text-slate-200 hover:text-white font-medium transition-colors"
            >
              <User className="w-3.5 h-3.5" />
              <span>{t('nav.login', 'Sign In / Staff Portal')}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
