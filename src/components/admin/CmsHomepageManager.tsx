/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { useLanguage } from '../../context/LanguageContext';

export interface SectionConfig {
  id: string;
  title_en: string;
  title_bn: string;
  enabled: boolean;
  order: number;
  limit: number;
}

export interface HomepageConfigData {
  id: string;
  featuredArticleId: string | null;
  breakingArticleId: string | null;
  breakingBannerActive: boolean;
  sectionOrder: SectionConfig[];
  updatedAt?: string;
}

export const CmsHomepageManager: React.FC = () => {
  const { lang } = useLanguage();
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const [config, setConfig] = useState<HomepageConfigData | null>(null);
  const [publishedArticles, setPublishedArticles] = useState<any[]>([]);
  const [showPreview, setShowPreview] = useState<boolean>(false);

  const fetchConfig = async () => {
    try {
      setLoading(true);
      setError(null);
      const token = localStorage.getItem('gc_token');
      const res = await fetch('/api/homepage/config', {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        throw new Error(`Failed to load homepage configuration (${res.status})`);
      }
      const data = await res.json();
      setConfig(data.config);
      setPublishedArticles(data.publishedArticles || []);
    } catch (err: any) {
      setError(err.message || 'Error fetching layout settings.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchConfig();
  }, []);

  const handleSave = async () => {
    if (!config) return;
    try {
      setSaving(true);
      setError(null);
      setSuccessMsg(null);
      const token = localStorage.getItem('gc_token');
      const res = await fetch('/api/homepage/config', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: token ? `Bearer ${token}` : '',
        },
        body: JSON.stringify({
          featuredArticleId: config.featuredArticleId,
          breakingArticleId: config.breakingArticleId,
          breakingBannerActive: config.breakingBannerActive,
          sectionOrder: config.sectionOrder,
        }),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Failed to update homepage configuration');
      }

      setSuccessMsg('Homepage layout configuration updated successfully! Server memory cache invalidated.');
      setTimeout(() => setSuccessMsg(null), 4000);
      fetchConfig();
    } catch (err: any) {
      setError(err.message || 'Failed to save configuration.');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleSection = (id: string) => {
    if (!config) return;
    const updated = config.sectionOrder.map((sec) =>
      sec.id === id ? { ...sec, enabled: !sec.enabled } : sec
    );
    setConfig({ ...config, sectionOrder: updated });
  };

  const handleMoveOrder = (index: number, direction: 'up' | 'down') => {
    if (!config) return;
    const sections = [...config.sectionOrder];
    const targetIdx = direction === 'up' ? index - 1 : index + 1;
    if (targetIdx < 0 || targetIdx >= sections.length) return;

    // Swap order numbers
    const tempOrder = sections[index].order;
    sections[index].order = sections[targetIdx].order;
    sections[targetIdx].order = tempOrder;

    // Swap positions in array
    const temp = sections[index];
    sections[index] = sections[targetIdx];
    sections[targetIdx] = temp;

    setConfig({ ...config, sectionOrder: sections });
  };

  const handleLimitChange = (id: string, limit: number) => {
    if (!config) return;
    const updated = config.sectionOrder.map((sec) =>
      sec.id === id ? { ...sec, limit: Math.max(1, limit) } : sec
    );
    setConfig({ ...config, sectionOrder: updated });
  };

  if (loading) {
    return (
      <div className="p-8 text-center bg-stone-50 border border-stone-200 rounded-lg">
        <div className="w-8 h-8 border-2 border-stone-800 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
        <p className="text-sm font-sans text-stone-600">Loading Homepage Layout Manager...</p>
      </div>
    );
  }

  if (!config) {
    return (
      <div className="p-6 bg-red-50 border border-red-200 text-red-800 rounded-lg">
        <p className="font-sans font-semibold">Unable to load configuration</p>
        <p className="text-xs mt-1">{error}</p>
        <button
          onClick={fetchConfig}
          className="mt-3 px-3 py-1.5 bg-red-800 text-white text-xs font-medium rounded hover:bg-red-900"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6 font-sans text-stone-900">
      {/* Header Bar */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between pb-4 border-b border-stone-300 gap-4">
        <div>
          <h2 className="text-2xl font-serif font-bold text-stone-900">Homepage Layout Manager</h2>
          <p className="text-xs text-stone-600 mt-1">
            Control broadsheet section ordering, feature lead stories, and toggle live breaking banners. Changes invalidate public cache instantly.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setShowPreview(!showPreview)}
            className="px-4 py-2 border border-stone-300 bg-white text-stone-700 hover:bg-stone-100 text-xs font-medium rounded transition-colors"
          >
            {showPreview ? 'Hide Live Preview' : 'Show Layout Preview'}
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="px-5 py-2 bg-stone-900 text-white hover:bg-stone-800 text-xs font-medium rounded transition-colors disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save Layout Settings'}
          </button>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 text-red-800 rounded text-xs">
          <strong>Error:</strong> {error}
        </div>
      )}

      {successMsg && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded text-xs font-medium">
          ✓ {successMsg}
        </div>
      )}

      {/* Global Overrides Box */}
      <div className="p-5 bg-stone-100 border border-stone-200 rounded-lg space-y-4">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-stone-800 border-b border-stone-200 pb-2">
          Global Broadsheet Overrides
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Lead Story Override */}
          <div>
            <label className="block text-xs font-semibold text-stone-700 mb-1">
              Featured Lead Story (Hero Split)
            </label>
            <select
              value={config.featuredArticleId || ''}
              onChange={(e) => setConfig({ ...config, featuredArticleId: e.target.value || null })}
              className="w-full text-xs p-2 bg-white border border-stone-300 rounded focus:outline-none focus:border-stone-800"
            >
              <option value="">(Automatic: Highest Priority / Most Recent Dispatch)</option>
              {publishedArticles.map((art) => (
                <option key={art.id} value={art.id}>
                  [{art.priority}] {art.title} ({art.category?.slug || 'General'})
                </option>
              ))}
            </select>
            <p className="text-[11px] text-stone-500 mt-1">
              Override the primary lead dispatch on the public homepage.
            </p>
          </div>

          {/* Breaking Banner Toggle */}
          <div>
            <label className="block text-xs font-semibold text-stone-700 mb-1">
              Breaking News Ticker Status
            </label>
            <div className="flex items-center gap-4 mt-2">
              <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-stone-800">
                <input
                  type="checkbox"
                  checked={config.breakingBannerActive}
                  onChange={(e) => setConfig({ ...config, breakingBannerActive: e.target.checked })}
                  className="rounded text-red-600 focus:ring-red-500"
                />
                Activate High-Priority Ticker Banner
              </label>
            </div>
            <p className="text-[11px] text-stone-500 mt-1">
              When active, displays a red breaking alert ribbon above the brand header.
            </p>
          </div>
        </div>
      </div>

      {/* Section Reordering Matrix */}
      <div className="border border-stone-200 rounded-lg overflow-hidden bg-white">
        <div className="p-4 bg-stone-100 border-b border-stone-200 flex items-center justify-between">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-stone-800">
            Broadsheet Section Sequence & Visibility
          </h3>
          <span className="text-xs text-stone-500 font-mono">
            {config.sectionOrder.filter((s) => s.enabled).length} of {config.sectionOrder.length} Active
          </span>
        </div>

        <div className="divide-y divide-stone-200">
          {config.sectionOrder.map((sec, idx) => (
            <div
              key={sec.id}
              className={`p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 transition-colors ${
                sec.enabled ? 'bg-white' : 'bg-stone-50 text-stone-400 opacity-60'
              }`}
            >
              <div className="flex items-center gap-3">
                <span className="w-6 h-6 flex items-center justify-center text-xs font-mono font-bold bg-stone-200 text-stone-700 rounded-full">
                  {idx + 1}
                </span>

                <input
                  type="checkbox"
                  checked={sec.enabled}
                  onChange={() => handleToggleSection(sec.id)}
                  className="w-4 h-4 rounded text-stone-800 focus:ring-stone-600 cursor-pointer"
                />

                <div>
                  <h4 className="text-sm font-semibold text-stone-900 flex items-center gap-2">
                    {lang === 'bn' ? sec.title_bn : sec.title_en}
                    <span className="text-xs text-stone-400 font-normal">({sec.title_en})</span>
                  </h4>
                  <p className="text-[11px] font-mono text-stone-500">ID: {sec.id}</p>
                </div>
              </div>

              <div className="flex items-center gap-4">
                {/* Items Limit */}
                <div className="flex items-center gap-2">
                  <label className="text-xs text-stone-600">Max Stories:</label>
                  <input
                    type="number"
                    value={sec.limit}
                    onChange={(e) => handleLimitChange(sec.id, parseInt(e.target.value) || 1)}
                    className="w-16 text-xs p-1 bg-white border border-stone-300 rounded text-center focus:outline-none focus:border-stone-800"
                    min={1}
                    max={12}
                  />
                </div>

                {/* Move Up / Down Buttons */}
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => handleMoveOrder(idx, 'up')}
                    disabled={idx === 0}
                    className="p-1.5 border border-stone-200 rounded text-stone-600 hover:bg-stone-100 disabled:opacity-30 text-xs"
                    title="Move section up"
                  >
                    ▲
                  </button>
                  <button
                    type="button"
                    onClick={() => handleMoveOrder(idx, 'down')}
                    disabled={idx === config.sectionOrder.length - 1}
                    className="p-1.5 border border-stone-200 rounded text-stone-600 hover:bg-stone-100 disabled:opacity-30 text-xs"
                    title="Move section down"
                  >
                    ▼
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Live Layout Preview Modal */}
      {showPreview && (
        <div className="p-6 bg-stone-100 border-2 border-dashed border-stone-300 rounded-lg space-y-4">
          <h3 className="text-sm font-bold uppercase tracking-wider text-stone-800">
            Live Broadsheet Layout Simulation
          </h3>
          <p className="text-xs text-stone-600">
            The layout below mirrors how enabled sections will reflow on the public homepage. Empty categories automatically hide without white space gaps.
          </p>

          <div className="space-y-3 pt-2">
            {config.sectionOrder
              .filter((s) => s.enabled)
              .map((sec, i) => (
                <div key={sec.id} className="p-3 bg-white border border-stone-300 rounded shadow-sm flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-mono font-bold text-stone-500">#{i + 1}</span>
                    <span className="text-xs font-serif font-semibold text-stone-900">
                      {sec.title_en} ({sec.title_bn})
                    </span>
                  </div>
                  <span className="text-[11px] font-mono px-2 py-0.5 bg-stone-100 text-stone-600 rounded">
                    Max {sec.limit} items
                  </span>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
};
