/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phase 10: Breaking-news management — real CRUD against the existing
 * /api/breaking-news endpoints (used by the public BreakingNewsBanner ticker).
 */
import React, { useState, useEffect, useCallback } from 'react';
import { Plus, Trash2, RefreshCw, Megaphone } from 'lucide-react';
import { AdminPanelHeader, ApiErrorBanner, adminApi, AdminApiError } from './adminApi';

interface Announcement {
  id: string;
  headline: string;
  summary?: string | null;
  articleId?: string | null;
  urgencyRank: number; // 1 Standard, 2 High, 3 Flash
  activeUntil?: string | null;
  isActive: boolean;
  createdAt: string;
}

export const CmsBreakingNews: React.FC<{ token: string }> = ({ token }) => {
  const api = adminApi(token);
  const [items, setItems] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<AdminApiError | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [headline, setHeadline] = useState('');
  const [summary, setSummary] = useState('');
  const [articleId, setArticleId] = useState('');
  const [urgency, setUrgency] = useState(1);
  const [canPublish, setCanPublish] = useState(true);

  useEffect(() => {
    fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((u) => setCanPublish(['SUPER_ADMIN', 'ADMIN', 'MANAGING_EDITOR', 'SECTION_EDITOR'].includes(u?.role)))
      .catch(() => setCanPublish(false));
  }, [token]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const announcements = await api.get<Announcement[]>('/api/breaking-news');
      setItems(Array.isArray(announcements) ? announcements : []);
    } catch (err) {
      setError(err as AdminApiError);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { void load(); }, []);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!headline.trim()) { setFormError('Headline is required.'); return; }
    setBusy(true);
    try {
      const payload: Record<string, unknown> = {
        headline: headline.trim(),
        urgencyRank: urgency,
        isActive: true,
      };
      if (summary.trim()) payload.summary = summary.trim();
      if (articleId.trim()) payload.articleId = articleId.trim();
      await api.post('/api/breaking-news', payload);
      setHeadline(''); setSummary(''); setArticleId(''); setUrgency(1);
      await load();
    } catch (err: any) {
      setFormError(err?.message || 'Could not create the announcement.');
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (item: Announcement) => {
    setBusy(true);
    try { await api.put(`/api/breaking-news/${item.id}`, { isActive: !item.isActive }); await load(); }
    catch (err: any) { setError(err); }
    finally { setBusy(false); }
  };

  const remove = async (item: Announcement) => {
    setBusy(true);
    try { await api.del(`/api/breaking-news/${item.id}`); await load(); }
    catch (err: any) { setError(err); }
    finally { setBusy(false); }
  };

  const urgencyLabel = ['Standard', 'High', 'Flash'];

  return (
    <div className="space-y-6" data-admin-screen="breaking-news">
      <AdminPanelHeader title="Breaking News Management" description="Active alerts drive the public BreakingNewsBanner ticker in real time." />
      <ApiErrorBanner error={error} onRetry={() => void load()} />

      {canPublish ? (
        <form onSubmit={create} className="bg-white border border-stone-200 rounded-2xl p-5 space-y-4" noValidate>
          <h3 className="font-serif font-bold text-sm text-stone-900 flex items-center gap-2"><Megaphone className="w-4 h-4" /> New Announcement</h3>
          {formError && <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2" role="alert">{formError}</p>}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <label className="md:col-span-2 text-xs font-semibold text-stone-700 flex flex-col gap-1">
              Headline *
              <input value={headline} onChange={(e) => setHeadline(e.target.value)} maxLength={140} required
                className="border border-stone-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-stone-800" />
            </label>
            <label className="text-xs font-semibold text-stone-700 flex flex-col gap-1">
              Urgency
              <select value={urgency} onChange={(e) => setUrgency(Number(e.target.value))}
                className="border border-stone-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-stone-800">
                <option value={1}>1 — Standard</option>
                <option value={2}>2 — High</option>
                <option value={3}>3 — Flash</option>
              </select>
            </label>
            <label className="md:col-span-3 text-xs font-semibold text-stone-700 flex flex-col gap-1">
              Summary (optional, shown alongside the ticker)
              <input value={summary} onChange={(e) => setSummary(e.target.value)} maxLength={200}
                className="border border-stone-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-stone-800" />
            </label>
            <label className="md:col-span-3 text-xs font-semibold text-stone-700 flex flex-col gap-1">
              Linked Article ID (optional — clicking the alert opens the story)
              <input value={articleId} onChange={(e) => setArticleId(e.target.value)} placeholder="art-…" maxLength={64}
                className="border border-stone-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-stone-800" />
            </label>
          </div>
          <button type="submit" disabled={busy}
            className="bg-red-700 hover:bg-red-800 disabled:opacity-50 text-white font-semibold px-4 py-2 rounded-lg text-xs inline-flex items-center gap-2">
            <Plus className="w-3.5 h-3.5" /> {busy ? 'Saving…' : 'Create Announcement'}
          </button>
        </form>
      ) : (
        <div className="bg-stone-100 border border-stone-200 text-stone-700 rounded-xl p-3 text-xs" role="note">
          Your role does not include publishing rights — announcements can be viewed but not created here. Ask a managing editor for access.
        </div>
      )}

      <div className="bg-white border border-stone-200 rounded-2xl p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-serif font-bold text-sm text-stone-900">Announcements ({items.length})</h3>
          <button onClick={() => void load()} className="text-xs font-semibold text-stone-600 hover:text-stone-900 inline-flex items-center gap-1" title="Refresh">
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </button>
        </div>
        {loading ? (
          <div className="py-8 text-center text-xs text-stone-400">Loading announcements…</div>
        ) : items.length === 0 ? (
          <div className="py-8 text-center text-xs text-stone-400 italic">No breaking announcements. The public ticker is idle.</div>
        ) : (
          <ul className="divide-y divide-stone-100">
            {items.map((item) => (
              <li key={item.id} className="py-3 flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${item.urgencyRank === 3 ? 'bg-red-100 text-red-700' : item.urgencyRank === 2 ? 'bg-amber-100 text-amber-700' : 'bg-stone-100 text-stone-600'}`}>
                      {urgencyLabel[(item.urgencyRank || 1) - 1]} Alert
                    </span>
                    {!item.isActive && <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-stone-200 text-stone-500">Inactive</span>}
                  </div>
                  <p className="font-semibold text-sm text-stone-900 mt-1 truncate">{item.headline}</p>
                  {item.summary && <p className="text-[11px] text-stone-500 truncate">{item.summary}</p>}
                </div>
                {canPublish && (
                  <div className="flex items-center gap-2 shrink-0">
                    <button onClick={() => void toggleActive(item)} disabled={busy}
                      className={`text-xs font-semibold px-3 py-1.5 rounded-lg disabled:opacity-50 ${item.isActive ? 'bg-stone-100 text-stone-700 hover:bg-stone-200' : 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'}`}>
                      {item.isActive ? 'Deactivate' : 'Activate'}
                    </button>
                    <button onClick={() => void remove(item)} disabled={busy} title="Delete announcement"
                      className="text-xs text-red-700 hover:bg-red-50 px-2.5 py-1.5 rounded-lg border border-red-200 disabled:opacity-50">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};
