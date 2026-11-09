import React, { useState, useEffect } from 'react';

/**
 * Phase 10: REAL ad delivery from this site's own inventory
 * (GET /api/ads — active AdPlacements only). Every visible impression and
 * click is recorded server-side. When no active slot exists the component
 * renders NOTHING — no fabricated sponsor copy, no fake placeholder data.
 * External ad networks are an explicit not-configured state surfaced in the
 * CMS (CmsAds), not disguised here.
 */

interface AdPlacement {
  id: string;
  slotName: string;
  dimensions: string;
  adCode: string;
  isActive: boolean;
}

export interface AdSlotProps {
  type?: 'leaderboard' | 'rectangle';
}

/** Shared, in-flight fetch so N mounts on one page don't skew impressions. */
let activeAdsCache: AdPlacement[] | null = null;
let activeAdsPromise: Promise<AdPlacement[]> | null = null;

function fetchActiveAds(): Promise<AdPlacement[]> {
  if (activeAdsCache) return Promise.resolve(activeAdsCache);
  if (!activeAdsPromise) {
    activeAdsPromise = fetch('/api/ads')
      .then((res) => (res.ok ? res.json() : []))
      .then((rows: unknown) => {
        const ads = (Array.isArray(rows) ? (rows as AdPlacement[]) : []).filter((a) => a && a.id && a.isActive);
        activeAdsCache = ads;
        activeAdsPromise = null;
        return ads;
      })
      .catch(() => {
        activeAdsPromise = null;
        return [] as AdPlacement[];
      });
  }
  return activeAdsPromise;
}

function trackEvent(adId: string, kind: 'impression' | 'click'): void {
  // Fire-and-forget telemetry; failures must never surface to the reader.
  fetch(`/api/ads/${encodeURIComponent(adId)}/${kind}`, { method: 'POST' }).catch(() => {});
}

export const AdSlot: React.FC<AdSlotProps> = ({ type = 'leaderboard' }) => {
  const [ad, setAd] = useState<AdPlacement | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchActiveAds().then((ads) => {
      if (cancelled) return;
      const preferred = ads.find((a) =>
        type === 'rectangle' ? /300|336|250/.test(a.dimensions) : /728|970|468/.test(a.dimensions),
      );
      setAd(preferred || ads[0] || null);
      setChecked(true);
      if (preferred || ads.length > 0) trackEvent((preferred || ads[0]).id, 'impression');
    });
    return () => { cancelled = true; };
  }, [type]);

  if (!ad && checked) return null; // no real inventory → no module rendered
  if (!ad) return null; // loading → nothing (no layout flash of fake data)

  const handleClick = () => {
    trackEvent(ad.id, 'click');
  };

  if (type === 'leaderboard') {
    return (
      <div
        className="my-6 mx-auto max-w-5xl bg-[#EBE6DF] dark:bg-[#1A1A1A] border border-[#D6CEBE] dark:border-[#333333] p-4 text-center text-xs font-sans-en"
        data-ad-slot={ad.slotName}
        data-ad-id={ad.id}
        data-ad-dimensions={ad.dimensions}
        role="complementary"
        aria-label="Sponsored placement"
      >
        <div className="text-[10px] font-bold text-[#666055] uppercase tracking-widest mb-1">
          ADVERTISEMENT · SPONSORED DISPATCH
        </div>
        <button
          type="button"
          onClick={handleClick}
          className="w-full py-4 border border-dashed border-[#C8C2B7] dark:border-[#444444] bg-[#FAF8F5] dark:bg-[#121212] flex flex-col items-center justify-center cursor-pointer hover:bg-[#F1EDE6] dark:hover:bg-[#181818] transition-colors"
          title={`Sponsored: ${ad.slotName}`}
        >
          <span className="font-bold text-[#1A1A1A] dark:text-[#E5E5E5] text-sm">{ad.adCode || ad.slotName}</span>
          <span className="text-[11px] text-[#666055]">{ad.slotName} · {ad.dimensions}</span>
        </button>
      </div>
    );
  }

  return (
    <div
      className="my-4 bg-[#EBE6DF] dark:bg-[#1A1A1A] border border-[#D6CEBE] dark:border-[#333333] p-3 text-center text-xs font-sans-en"
      data-ad-slot={ad.slotName}
      data-ad-id={ad.id}
      data-ad-dimensions={ad.dimensions}
      role="complementary"
      aria-label="Sponsored placement"
    >
      <div className="text-[10px] font-bold text-[#666055] uppercase tracking-widest mb-1">
        ADVERTISEMENT
      </div>
      <button
        type="button"
        onClick={handleClick}
        className="w-full h-48 border border-dashed border-[#C8C2B7] dark:border-[#444444] bg-[#FAF8F5] dark:bg-[#121212] flex flex-col items-center justify-center p-3 cursor-pointer hover:bg-[#F1EDE6] dark:hover:bg-[#181818] transition-colors"
        title={`Sponsored: ${ad.slotName}`}
      >
        <span className="font-bold text-[#1A1A1A] dark:text-[#E5E5E5] text-xs">{ad.adCode || ad.slotName}</span>
        <span className="text-[10px] text-[#666055] mt-1">{ad.slotName}</span>
      </button>
    </div>
  );
};
