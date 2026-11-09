/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phase 10: Site settings & language configuration — real stored settings
 * (GET/PUT /api/admin/settings). Language default feeds the public language
 * provider; only validated keys/types accepted by the server.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Save } from 'lucide-react';
import { AdminPanelHeader, ApiErrorBanner, adminApi, AdminApiError } from './adminApi';

interface SettingsPayload {
  settings: Record<string, string | number | boolean | null>;
  allowedKeys: string[];
}

const FIELD_META: Record<string, { label: string; kind: 'text' | 'boolean' | 'language'; hint?: string }> = {
  siteTitle: { label: 'Site title', kind: 'text' },
  tagline: { label: 'Tagline', kind: 'text' },
  editorialMotto: { label: 'Editorial motto (footer)', kind: 'text' },
  contactEmail: { label: 'Newsroom contact email', kind: 'text' },
  defaultLanguage: { label: 'Default language', kind: 'language', hint: 'Initial switch state for Bangla/English readers' },
  newsletterEnabled: { label: 'Newsletter signup enabled (public forms)', kind: 'boolean' },
  commentsRequireApproval: { label: 'Comments require approval before visible', kind: 'boolean' },
  breakingBannerAutoRefresh: { label: 'Breaking banner auto-refresh', kind: 'boolean' },
};

export const CmsSettings: React.FC<{ token: string }> = ({ token }) => {
  const api = adminApi(token);
  const [data, setData] = useState<SettingsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<AdminApiError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = await api.get<SettingsPayload>('/api/admin/settings');
      setData(payload);
    } catch (err) {
      setError(err as AdminApiError);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { void load(); }, []);

  const setValue = (key: string, value: string | number | boolean | null) => {
    setData((prev) => (prev ? { ...prev, settings: { ...prev.settings, [key]: value } } : prev));
  };

  const save = async () => {
    if (!data) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      const payload = {
        settings: data.allowedKeys
          .filter((k) => data.settings[k] !== null && data.settings[k] !== undefined && data.settings[k] !== '')
          .map((k) => ({ key: k, value: data.settings[k] })),
      };
      await api.put('/api/admin/settings', payload as any);
      setNotice('Settings saved and applied to the public site.');
      await load();
    } catch (err: any) {
      setError(err);
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-6" data-admin-screen="settings">
      <AdminPanelHeader title="Site Settings & Language" description="Stored configuration applied across the public portal.">
        <div className="flex items-center gap-2">
          <button onClick={() => void load()} className="text-xs font-semibold text-stone-600 hover:text-stone-900 inline-flex items-center gap-1" title="Refresh"><RefreshCw className="w-3.5 h-3.5" /> Refresh</button>
          <button onClick={() => void save()} disabled={busy || loading} className="bg-stone-900 hover:bg-stone-800 disabled:opacity-50 text-white text-xs font-semibold px-3 py-2 rounded-lg inline-flex items-center gap-1">
            <Save className="w-3.5 h-3.5" /> {busy ? 'Saving…' : 'Save Settings'}
          </button>
        </div>
      </AdminPanelHeader>
      <ApiErrorBanner error={error} onRetry={() => void load()} />
      {notice && <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded p-2" role="status">{notice}</p>}

      <div className="bg-white border border-stone-200 rounded-2xl p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
        {loading || !data ? (
          <p className="py-6 md:col-span-2 text-center text-xs text-stone-400">Loading settings…</p>
        ) : data.allowedKeys.map((key) => {
          const meta = FIELD_META[key] || { label: key, kind: 'text' as const };
          const value = data.settings[key];
          return (
            <label key={key} className="text-xs font-semibold text-stone-700 flex flex-col gap-1">
              {meta.label}
              {meta.kind === 'boolean' ? (
                <select value={value === true ? 'true' : 'false'} onChange={(e) => setValue(key, e.target.value === 'true')}
                  className="border border-stone-300 rounded-lg px-3 py-2 text-sm">
                  <option value="true">Enabled</option>
                  <option value="false">Disabled</option>
                </select>
              ) : meta.kind === 'language' ? (
                <select value={value === 'bn' ? 'bn' : 'en'} onChange={(e) => setValue(key, e.target.value)}
                  className="border border-stone-300 rounded-lg px-3 py-2 text-sm">
                  <option value="en">English (en)</option>
                  <option value="bn">বাংলা (bn)</option>
                </select>
              ) : (
                <input value={value != null ? String(value) : ''} onChange={(e) => setValue(key, e.target.value)}
                  maxLength={200} className="border border-stone-300 rounded-lg px-3 py-2 text-sm" />
              )}
              {'hint' in meta && meta.hint && <span className="text-[10px] text-stone-400">{meta.hint}</span>}
            </label>
          );
        })}
      </div>
    </div>
  );
};
