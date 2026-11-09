/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { useLanguage } from '../context/LanguageContext';
import { LeadStoryModule } from '../components/design-system/LeadStoryModule';
import { LatestNewsList } from '../components/design-system/LatestNewsList';
import { CategoryHeading } from '../components/design-system/CategoryHeading';
import { NewsCard, ArticleData } from '../components/design-system/NewsCard';
import { AdSlot } from '../components/design-system/AdSlot';
import { PageMetadata } from '../components/design-system/PageMetadata';
import { LoadingSkeleton } from '../components/design-system/LoadingSkeleton';
import { BarChart2, TrendingUp, Radio } from 'lucide-react';

interface HomeProps {
  onSelectArticle: (slug: string) => void;
  onSelectCategory: (slug: string) => void;
}

export const Home: React.FC<HomeProps> = ({ onSelectArticle, onSelectCategory }) => {
  const { lang } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [homepageData, setHomepageData] = useState<any>(null);
  const [poll, setPoll] = useState<any>(null);
  const [voted, setVoted] = useState(false);

  const fetchHomepage = async () => {
    try {
      const [hpRes, pollRes] = await Promise.all([
        fetch('/api/homepage').then((res) => res.json()),
        fetch('/api/polls').then((res) => res.json()).catch(() => null),
      ]);
      setHomepageData(hpRes);
      if (pollRes && !pollRes.error) setPoll(pollRes);
    } catch (err) {
      console.error('Error fetching broadsheet homepage payload:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHomepage();
  }, []);

  const handleVote = async (optionIndex: number) => {
    if (!poll || voted) return;
    try {
      const res = await fetch(`/api/polls/${poll.id}/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ optionIndex }),
      });
      const updated = await res.json();
      setPoll(updated);
      setVoted(true);
    } catch (err) {
      console.error('Failed to submit poll vote:', err);
    }
  };

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 lg:px-8 py-8 space-y-8">
        <LoadingSkeleton type="lead" />
        <LoadingSkeleton type="grid" />
      </div>
    );
  }

  if (!homepageData) {
    return (
      <div className="max-w-7xl mx-auto px-4 lg:px-8 py-16 text-center">
        <h2 className="text-xl font-serif font-bold text-stone-900">Broadsheet Feed Temporarily Offline</h2>
        <p className="text-xs text-stone-500 mt-2">Unable to connect to the newsroom database service.</p>
        <button
          onClick={fetchHomepage}
          className="mt-4 px-4 py-2 bg-stone-900 text-white text-xs font-semibold rounded hover:bg-stone-800"
        >
          Retry Connection
        </button>
      </div>
    );
  }

  const {
    leadStory,
    leadRelated = [],
    secondaryStories = [],
    latestNews = [],
    mostRead = [],
    categoriesMap = {},
    activeSectionOrder = [],
  } = homepageData;

  const mapArticle = (a: any): ArticleData => ({
    id: a.id,
    slug: a.slug,
    title: a.title,
    titleBn: a.titleBn,
    summary: a.excerpt || a.summary,
    summaryBn: a.summaryBn,
    content: a.content,
    categoryName: a.category?.name || a.categoryName,
    categorySlug: a.category?.slug || a.categorySlug,
    authorName: a.author?.name || a.authorName || 'Staff Reporter',
    publishedAt: a.publishedAt || a.createdAt,
    imageUrl: a.coverImage || a.imageUrl,
    focalX: a.focalX,
    focalY: a.focalY,
    readTimeMinutes: a.readTimeMinutes || 4,
  });

  const leadMapped = leadStory ? mapArticle(leadStory) : null;
  const leadRelatedMapped = leadRelated.map(mapArticle);
  const secondaryMapped = secondaryStories.map(mapArticle);
  const latestMapped = latestNews.map(mapArticle);
  const mostReadMapped = mostRead.map(mapArticle);

  return (
    <div className="max-w-7xl mx-auto px-4 lg:px-8 py-6 space-y-12">
      <PageMetadata
        title="Global Chronicle News"
        description="Independent journalism from the Global Chronicle bureau network — breaking dispatches, analysis and verified reporting."
        canonicalPath="/"
      />
      {/* Dynamic Broadsheet Section Engine */}
      {activeSectionOrder.map((section: any, idx: number) => {
        const secId = section.id;

        // 1. Lead Story & Wire Split
        if (secId === 'lead_story') {
          if (!leadMapped) return null;
          return (
            <div key={secId} className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
              <div className="lg:col-span-8">
                <LeadStoryModule
                  leadArticle={leadMapped}
                  relatedArticles={leadRelatedMapped}
                  onSelectArticle={onSelectArticle}
                />
              </div>

              <div className="lg:col-span-4 space-y-6">
                <LatestNewsList
                  articles={latestMapped.length > 0 ? latestMapped : [leadMapped]}
                  onSelectArticle={onSelectArticle}
                  onViewAll={() => onSelectCategory('world')}
                />

                {/* Reader Opinion Poll Module */}
                {poll && (
                  <div className="bg-[#FAF8F5] dark:bg-[#181818] border border-[#E2DDD5] dark:border-[#2A2A2A] p-4 space-y-3">
                    <div className="flex items-center space-x-2 text-[#990000] border-b border-[#E2DDD5] dark:border-[#2A2A2A] pb-2">
                      <BarChart2 className="w-4 h-4" />
                      <h4 className="text-xs font-bold uppercase tracking-widest text-[#1A1A1A] dark:text-[#E5E5E5]">
                        {lang === 'bn' ? 'পাঠক মতামতের জরিপ' : 'READER OPINION POLL'}
                      </h4>
                    </div>
                    <p className="text-xs font-bold text-[#1A1A1A] dark:text-[#E5E5E5] font-serif">
                      {poll.question}
                    </p>
                    <div className="space-y-2">
                      {poll.options.map((opt: any, oIdx: number) => {
                        const totalVotes = poll.options.reduce((sum: number, o: any) => sum + o.votes, 0) || 1;
                        const pct = Math.round((opt.votes / totalVotes) * 100);
                        return (
                          <button
                            key={oIdx}
                            disabled={voted}
                            onClick={() => handleVote(oIdx)}
                            className="w-full text-left p-2 rounded border border-[#E2DDD5] dark:border-[#333333] hover:border-[#990000] bg-white dark:bg-[#222222] transition-colors relative overflow-hidden group"
                          >
                            {voted && (
                              <div
                                className="absolute left-0 top-0 bottom-0 bg-red-100 dark:bg-red-950/60 transition-all duration-500"
                                style={{ width: `${pct}%` }}
                              />
                            )}
                            <div className="flex justify-between items-center relative z-10 text-xs font-medium text-[#1A1A1A] dark:text-[#E5E5E5]">
                              <span>{opt.option}</span>
                              {voted && <span className="font-bold text-[#990000]">{pct}%</span>}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        }

        // 2. Secondary Headlines Cluster
        if (secId === 'secondary_cluster') {
          if (secondaryMapped.length === 0) return null;
          return (
            <section key={secId} className="space-y-4 pt-6 border-t border-[#E2DDD5] dark:border-[#2A2A2A]">
              <CategoryHeading
                title="Top Headlines & Special Dispatches"
                titleBn="শীর্ষ সংবাদ ও বিশেষ প্রতিবেদন"
                subtitle="Curated coverage across geopolitical, economic, and civic frontiers."
              />
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                {secondaryMapped.slice(0, section.limit || 4).map((art: ArticleData) => (
                  <NewsCard key={art.id} article={art} layout="vertical" onSelectArticle={onSelectArticle} />
                ))}
              </div>
            </section>
          );
        }

        // 3. Ad Placement Banner
        if (idx === 2) {
          return (
            <React.Fragment key={`ad-${idx}`}>
              <AdSlot type="leaderboard" />
            </React.Fragment>
          );
        }

        // 4. Most Read Ranked Section
        if (secId === 'most_read') {
          if (mostReadMapped.length === 0) return null;
          return (
            <section key={secId} className="p-6 bg-stone-100 dark:bg-stone-900 border border-[#E2DDD5] dark:border-[#2A2A2A] rounded-lg space-y-4">
              <div className="flex items-center space-x-2 text-red-700 border-b border-stone-200 dark:border-stone-800 pb-3">
                <TrendingUp className="w-5 h-5" />
                <h3 className="font-serif font-bold text-lg text-stone-900 dark:text-stone-100">
                  {lang === 'bn' ? 'সর্বাধিক পঠিত সংবাদ' : 'Most Read Dispatches'}
                </h3>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                {mostReadMapped.slice(0, section.limit || 5).map((art: ArticleData, rank: number) => (
                  <div
                    key={art.id}
                    onClick={() => onSelectArticle(art.slug)}
                    className="p-3 bg-white dark:bg-stone-800 border border-stone-200 dark:border-stone-700 rounded cursor-pointer hover:border-red-700 transition-colors space-y-2 group"
                  >
                    <span className="text-2xl font-serif font-black text-red-700">0{rank + 1}</span>
                    <h4 className="font-serif font-bold text-xs text-stone-900 dark:text-stone-100 line-clamp-3 group-hover:text-red-700 transition-colors">
                      {lang === 'bn' && art.titleBn ? art.titleBn : art.title}
                    </h4>
                    <span className="text-[10px] text-stone-500 font-sans block">{art.categoryName}</span>
                  </div>
                ))}
              </div>
            </section>
          );
        }

        // 5. Category-Specific Sections (bangladesh, world, politics, economy, sports, entertainment, tech, opinion, video-photo)
        const catArticles = (categoriesMap[secId] || []).map(mapArticle);
        if (catArticles.length === 0) {
          // Zero-story section: automatically collapsed without layout shift or blank spaces!
          return null;
        }

        return (
          <section key={secId} className="space-y-4 pt-6 border-t border-[#E2DDD5] dark:border-[#2A2A2A]">
            <CategoryHeading
              title={section.title_en}
              titleBn={section.title_bn}
              onViewAll={() => onSelectCategory(secId)}
            />
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {catArticles.slice(0, section.limit || 4).map((art: ArticleData) => (
                <NewsCard key={art.id} article={art} layout="vertical" onSelectArticle={onSelectArticle} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
};
