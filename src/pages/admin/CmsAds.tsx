/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phase 10: Ad slot/campaign management — real stored placements with live
 * delivery metrics. External ad networks (DoubleClick-style tags) are NOT
 * configured: an explicit notice states that; no fabricated delivery data.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { Plus, RefreshCw, Activity, MousePointerClick, Trash2 } from 'lucide-react';
import { AdminPanelHeader, ApiErrorBanner, NotConfiguredNotice, adminApi, AdminApiError } from './adminApi';

interface AdPlacement {
  id: string;
  slotName: string;
  dimensions: string;
  adCode: string;
  isActive: boolean;
  impressions: number;
  clicks: number;
  createdAt: string;
  updatedAt: string;
}

export const CmsAds: React.FC<{ token: string }> = ({ token }) => {
  const api = adminApi(token);
  const [items, setItems] = useState<AdPlacement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<AdminApiError | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [slotName, setSlotName] = useState('');
  const [dimensions, setDimensions] = useState('728x90');
  const [adCode, setAdCode] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const all = await api.get<AdPlacement[]>('/api/admin/ads');
      setItems(Array.isArray(all) ? all : []);
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
    setBusy(true);
    try {
      await api.post('/api/admin/ads', { slotName, dimensions, adCode: adCode || undefined, isActive: true });
      setSlotName(''); setAdCode('');
      await load();
    } catch (err: any) {
      setFormError(err?.message || 'Could not create the ad slot.');
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (item: AdPlacement) => {
    setBusy(true);
    try { await api.put(`/api/admin/ads/${item.id}`, { isActive: !item.isActive }); await load(); }
    catch (err: any) { setError(err); }
    finally { setBusy(false); }
  };

  const removeOrDeactivate = async (item: AdPlacement) => {
    setBusy(true);
    try {
      const result: any = await api.del(`/api/admin/ads/${item.id}`);
      if (result?.archived) window.alert('Slot deactivated — its delivery metrics are preserved. Repeat delete to remove permanently.');
      await load();
    } catch (err: any) { setError(err); }
    finally { setBusy(false); }
  };

  const ctr = (item: AdPlacement) =>
    item.impressions > 0 ? `${((item.clicks / item.impressions) * 100).toFixed(1)}%` : '—';

  return (
    <div className="space-y-6" data-admin-screen="ads">
      <AdminPanelHeader title="Ad Slot Management" description="Homepage slots, sponsor copy and live delivery metrics stored in the publishing database." />
      <NotConfiguredNotice
        service="external ad networks (programmatic/std tags)"
        reason="Slots below are served from this application's own store. Connect an external network by adding its tag code to a slot's ad code field once credentials exist."
      />
      <ApiErrorBanner error={error} onRetry={() => void load()} />

      <form onSubmit={create} className="bg-white border border-stone-200 rounded-2xl p-5 space-y-4" noValidate>
        <h3 className="font-serif font-bold text-sm text-stone-900">New Ad Slot</h3>
        {formError && <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2" role="alert">{formError}</p>}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <label className="text-xs font-semibold text-stone-700 flex flex-col gap-1">
            Slot name * (e.g. LEADERBOARD TOP)
            <input value={slotName} onChange={(e) => setSlotName(e.target.value)} maxLength={40} required
              className="border border-stone-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-stone-800" />
          </label>
          <label className="text-xs font-semibold text-stone-700 flex flex-col gap-1">
            Dimensions *
            <input value={dimensions} onChange={(e) => setDimensions(e.target.value)} placeholder="728x90" pattern="\d{2,4}x\d{2,4}" required
              className="border border-stone-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-stone-800" />
          </label>
          <label className="text-xs font-semibold text-stone-700 flex flex-col gap-1">
            Sponsor / tag text (shown on the public slot)
            <input value={adCode} onChange={(e) => setAdCode(e.target.value)} maxLength={2000}
              className="border border-stone-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-stone-800" />
          </label>
        </div>
        <button type="submit" disabled={busy}
          className="bg-stone-900 hover:bg-stone-800 disabled:opacity-50 text-white font-semibold px-4 py-2 rounded-lg text-xs inline-flex items-center gap-2">
          <Plus className="w-3.5 h-3.5" /> {busy ? 'Saving…' : 'Create Slot'}
        </button>
      </form>

      <div className="bg-white border border-stone-200 rounded-2xl p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-serif font-bold text-sm text-stone-900">Slots ({items.length})</h3>
          <button onClick={() => void load()} className="text-xs font-semibold text-stone-600 hover:text-stone-900 inline-flex items-center gap-1" title="Refresh">
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </button>
        </div>
        {loading ? (
          <div className="py-8 text-center text-xs text-stone-400">Loading ad slots…</div>
        ) : items.length === 0 ? (
          <div className="py-8 text-center text-xs text-stone-400 italic">No ad slots yet. The homepage hides its ad module entirely until a real slot exists (no placeholder data).</div>
        ) : (
          <ul className="divide-y divide-stone-100">
            {items.map((item) => (
              <li key={item.id} className="py-3 flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-sm text-stone-900">{item.slotName}</span>
                    <span className="text-[10px] font-mono bg-stone-100 rounded px-1.5 py-0.5 text-stone-600">{item.dimensions}</span>
                    {item.isActive
                      ? <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">Active</span>
                      : <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-stone-200 text-stone-500">Inactive</span>}
                  </div>
                  <p className="text-[11px] text-stone-500 mt-0.5 flex items-center gap-3">
                    <span className="inline-flex items-center gap-1"><Activity className="w-3 h-3" /> {item.impressions.toLocaleString()} impressions</span>
                    <span className="inline-flex items-center gap-1"><MousePointerClick className="w-3 h-3" /> {item.clicks.toLocaleString()} clicks · CTR {ctr(item)}</span>
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button onClick={() => void toggleActive(item)} disabled={busy}
                    className={`text-xs font-semibold px-3 py-1.5 rounded-lg disabled:opacity-50 ${item.isActive ? 'bg-stone-100 text-stone-700 hover:bg-stone-200' : 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'}`}>
                    {item.isActive ? 'Deactivate' : 'Activate'}
                  </button>
                  <button onClick={() => void removeOrDeactivate(item)} disabled={busy} title={item.isActive ? 'Deactivate slot' : 'Delete slot permanently'}
                    className="text-xs text-red-700 hover:bg-red-50 px-2.5 py-1.5 rounded-lg border border-red-200 disabled:opacity-50">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};
