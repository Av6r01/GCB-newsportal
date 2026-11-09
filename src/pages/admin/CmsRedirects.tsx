/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phase 10: Redirect management — real URL redirect table (served by the
 * Phase 9 SEO middleware + article API). Manual 301/302 rules editable here;
 * slug-change auto-redirects appear in the same table.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Plus, Trash2, ArrowRight } from 'lucide-react';
import { AdminPanelHeader, ApiErrorBanner, adminApi, AdminApiError } from './adminApi';

interface UrlRedirect {
  id: string;
  sourcePath: string;
  destinationPath: string;
  statusCode: number;
  isActive: boolean;
  createdAt: string;
}

export const CmsRedirects: React.FC<{ token: string }> = ({ token }) => {
  const api = adminApi(token);
  const [items, setItems] = useState<UrlRedirect[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<AdminApiError | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState({ sourcePath: '', destinationPath: '', statusCode: 301 });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await api.get<UrlRedirect[]>('/api/admin/redirects');
      setItems(Array.isArray(rows) ? rows : []);
    } catch (err) {
      setError(err as AdminApiError);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { void load(); }, []);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null); setBusy(true);
    try {
      await api.post('/api/admin/redirects', draft);
      setDraft({ sourcePath: '', destinationPath: '', statusCode: 301 });
      await load();
    } catch (err: any) {
      setFormError(err?.message || 'Could not create the redirect.');
    } finally { setBusy(false); }
  };

  const toggleActive = async (item: UrlRedirect) => {
    setBusy(true); setError(null);
    try { await api.put(`/api/admin/redirects/${item.id}`, { isActive: !item.isActive }); await load(); }
    catch (err: any) { setError(err); }
    finally { setBusy(false); }
  };

  const remove = async (item: UrlRedirect) => {
    setBusy(true); setError(null);
    try { await api.del(`/api/admin/redirects/${item.id}`); await load(); }
    catch (err: any) { setError(err); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-6" data-admin-screen="redirects">
      <AdminPanelHeader title="URL Redirects" description="Manual 301/308 rules for retired URLs; automatic slug-change redirects appear here too.">
        <button onClick={() => void load()} className="text-xs font-semibold text-stone-600 hover:text-stone-900 inline-flex items-center gap-1" title="Refresh"><RefreshCw className="w-3.5 h-3.5" /> Refresh</button>
      </AdminPanelHeader>
      <ApiErrorBanner error={error} onRetry={() => void load()} />

      <form onSubmit={create} className="bg-white border border-stone-200 rounded-2xl p-5 space-y-4" noValidate>
        <h3 className="font-serif font-bold text-sm text-stone-900">New Redirect</h3>
        {formError && <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2" role="alert">{formError}</p>}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <label className="md:col-span-1 text-xs font-semibold text-stone-700 flex flex-col gap-1">
            Old path * (/article/old-slug)
            <input value={draft.sourcePath} onChange={(e) => setDraft({ ...draft, sourcePath: e.target.value })} placeholder="/article/…" required maxLength={300}
              className="border border-stone-300 rounded-lg px-3 py-2 text-sm font-mono" />
          </label>
          <label className="md:col-span-2 text-xs font-semibold text-stone-700 flex flex-col gap-1">
            Destination * (new path)
            <input value={draft.destinationPath} onChange={(e) => setDraft({ ...draft, destinationPath: e.target.value })} placeholder="/article/…" required maxLength={300}
              className="border border-stone-300 rounded-lg px-3 py-2 text-sm font-mono" />
          </label>
          <label className="text-xs font-semibold text-stone-700 flex flex-col gap-1">
            Status
            <select value={draft.statusCode} onChange={(e) => setDraft({ ...draft, statusCode: Number(e.target.value) })} className="border border-stone-300 rounded-lg px-3 py-2 text-sm">
              <option value={301}>301 — Moved permanently</option>
              <option value={308}>308 — Permanent (keep method)</option>
              <option value={302}>302 — Temporary</option>
            </select>
          </label>
        </div>
        <button type="submit" disabled={busy} className="bg-stone-900 hover:bg-stone-800 disabled:opacity-50 text-white font-semibold px-4 py-2 rounded-lg text-xs inline-flex items-center gap-1">
          <Plus className="w-3.5 h-3.5" /> Create Redirect
        </button>
      </form>

      <div className="bg-white border border-stone-200 rounded-2xl p-5 space-y-2">
        <h3 className="font-serif font-bold text-sm text-stone-900 pb-2 border-b border-stone-100">Table ({items.length})</h3>
        {loading ? (
          <p className="py-8 text-center text-xs text-stone-400">Loading redirects…</p>
        ) : items.length === 0 ? (
          <p className="py-8 text-center text-xs text-stone-400 italic">No redirects on record.</p>
        ) : (
          <ul className="divide-y divide-stone-100">
            {items.map((item) => (
              <li key={item.id} className="py-3 flex flex-col md:flex-row md:items-center justify-between gap-2 text-xs">
                <div className="min-w-0 flex items-center gap-2 flex-wrap">
                  <code className="bg-stone-100 rounded px-1.5 py-0.5 font-mono text-stone-800">{item.sourcePath}</code>
                  <ArrowRight className="w-3 h-3 text-stone-400 shrink-0" />
                  <code className="bg-stone-100 rounded px-1.5 py-0.5 font-mono text-stone-800">{item.destinationPath}</code>
                  <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${item.statusCode >= 308 ? 'bg-blue-100 text-blue-700' : 'bg-stone-200 text-stone-600'}`}>{item.statusCode}</span>
                  {!item.isActive && <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-red-100 text-red-700">Off</span>}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button onClick={() => void toggleActive(item)} disabled={busy}
                    className={`text-xs font-semibold px-3 py-1.5 rounded-lg disabled:opacity-50 ${item.isActive ? 'bg-stone-100 text-stone-700 hover:bg-stone-200' : 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'}`}>
                    {item.isActive ? 'Deactivate' : 'Activate'}
                  </button>
                  <button onClick={() => void remove(item)} disabled={busy} title="Delete redirect" className="p-2 rounded hover:bg-red-50 text-red-700 disabled:opacity-40"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};
