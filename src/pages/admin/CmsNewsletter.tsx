/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phase 10: Newsletter subscriber management — real subscriber list + removal.
 * Outbound delivery is explicitly not-configured (SMTP missing) — stated here,
 * never simulated.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Trash2, MailCheck } from 'lucide-react';
import { AdminPanelHeader, ApiErrorBanner, NotConfiguredNotice, adminApi, AdminApiError } from './adminApi';

interface Subscription {
  id: string;
  email: string;
  frequency?: string;
  isConfirmed?: boolean;
  subscribedAt: string;
}

export const CmsNewsletter: React.FC<{ token: string }> = ({ token }) => {
  const api = adminApi(token);
  const [items, setItems] = useState<Subscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<AdminApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [canManage, setCanManage] = useState(true);

  useEffect(() => {
    fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((u) => setCanManage(['SUPER_ADMIN', 'ADMIN'].includes(u?.role) || u?.role === 'MANAGING_EDITOR'))
      .catch(() => setCanManage(false));
  }, [token]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const subs = await api.get<Subscription[]>('/api/admin/newsletter/subscribers');
      setItems(Array.isArray(subs) ? subs : []);
    } catch (err) {
      setError(err as AdminApiError);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { void load(); }, []);

  const remove = async (item: Subscription) => {
    setBusy(true);
    try { await api.del(`/api/admin/newsletter/subscribers/${item.id}`); await load(); }
    catch (err: any) { setError(err); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-6" data-admin-screen="newsletter">
      <AdminPanelHeader
        title="Newsletter Subscribers"
        description={`${items.length} registered subscriber${items.length === 1 ? '' : 's'} · opt-out removal is available per row.`}
      >
        <button onClick={() => void load()} className="text-xs font-semibold text-stone-600 hover:text-stone-900 inline-flex items-center gap-1" title="Refresh">
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </button>
      </AdminPanelHeader>

      <NotConfiguredNotice
        service="outbound newsletter delivery (SMTP)"
        reason="New sign-ups are stored and confirmed-address pending; nothing is emailed until an SMTP provider is configured in the environment. This panel shows stored state only — delivery metrics are never simulated."
      />
      <ApiErrorBanner error={error} onRetry={() => void load()} />

      <div className="bg-white border border-stone-200 rounded-2xl p-5 space-y-3">
        {loading ? (
          <div className="py-8 text-center text-xs text-stone-400">Loading subscribers…</div>
        ) : items.length === 0 ? (
          <div className="py-8 text-center text-xs text-stone-400 italic">
            No subscribers yet. The public subscribe form (article pages) stores entries here.
          </div>
        ) : (
          <ul className="divide-y divide-stone-100">
            {items.map((item) => (
              <li key={item.id} className="py-3 flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-stone-900 truncate flex items-center gap-2">
                    {item.email}
                    {item.isConfirmed
                      ? <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 inline-flex items-center gap-1"><MailCheck className="w-2.5 h-2.5" /> Confirmed</span>
                      : <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">Unconfirmed</span>}
                  </p>
                  <p className="text-[11px] text-stone-500">
                    {item.frequency || 'DAILY'} · subscribed {new Date(item.subscribedAt).toLocaleDateString()}
                  </p>
                </div>
                {canManage && (
                  <button onClick={() => void remove(item)} disabled={busy} title="Unsubscribe this address"
                    className="text-xs text-red-700 hover:bg-red-50 px-2.5 py-1.5 rounded-lg border border-red-200 disabled:opacity-50 inline-flex items-center gap-1 shrink-0">
                    <Trash2 className="w-3.5 h-3.5" /> Unsubscribe
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};
