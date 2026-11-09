/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phase 10: Analytics — first-party event reporting with defined event
 * taxonomy and selectable reporting windows (GET /api/admin/analytics/report).
 * Third-party analytics (GA4 & co.) are explicitly not configured — stated.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { RefreshCw, BarChart2 } from 'lucide-react';
import { AdminPanelHeader, ApiErrorBanner, NotConfiguredNotice, adminApi, AdminApiError } from './adminApi';

interface Report {
  window: string;
  generatedAt: string;
  total: number;
  byType: Record<string, number>;
  byDay: Array<{ day: string; count: number }>;
  recentEvents: Array<{ id: string; type: string; entityId?: string | null; metadata?: any; createdAt: string }>;
}

const WINDOWS = ['24h', '7d', '30d', '90d'] as const;
const EVENT_LABELS: Record<string, string> = {
  PAGE_VIEW: 'Page views',
  ARTICLE_VIEW: 'Article opens',
  SHARE: 'Shares',
  CLICK: 'Clicks',
  SEARCH: 'Searches',
  SUBSCRIBE: 'Newsletter sign-ups',
  COMMENT: 'Comments',
  REACTION: 'Reactions',
};

export const CmsAnalytics: React.FC<{ token: string }> = ({ token }) => {
  const api = adminApi(token);
  const [window, setWindow] = useState<(typeof WINDOWS)[number]>('7d');
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<AdminApiError | null>(null);

  const load = useCallback(async (w: string) => {
    setLoading(true);
    setError(null);
    try {
      const r = await api.get<Report>(`/api/admin/analytics/report?window=${w}`);
      setReport(r);
    } catch (err) {
      setError(err as AdminApiError);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { void load(window); }, [window]);

  const maxDay = Math.max(1, ...(report?.byDay.map((d) => d.count) || []));

  return (
    <div className="space-y-6" data-admin-screen="analytics">
      <AdminPanelHeader title="Engagement Analytics" description="First-party reader events recorded by this site — defined taxonomy, defined windows.">
        <div className="flex rounded-lg border border-stone-200 overflow-hidden" role="tablist" aria-label="Reporting window">
          {WINDOWS.map((w) => (
            <button key={w} onClick={() => setWindow(w)}
              className={`px-3 py-1.5 text-xs font-semibold ${window === w ? 'bg-stone-900 text-white' : 'bg-white text-stone-600 hover:bg-stone-50'}`}
              title={`Last ${w}`}>{w}</button>
          ))}
          <button onClick={() => void load(window)} className="px-2.5 bg-white text-stone-600 hover:bg-stone-50 border-l border-stone-200" title="Refresh">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </AdminPanelHeader>

      <NotConfiguredNotice
        service="third-party analytics providers"
        reason="This dashboard reports ONLY first-party events stored in this site's database. No external analytics account is connected — no cross-platform data is shown or imported."
      />
      <ApiErrorBanner error={error} onRetry={() => void load(window)} />

      {loading || !report ? (
        <div className="py-16 text-center text-xs text-stone-400">Crunching events…</div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {Object.entries(EVENT_LABELS).map(([type, label]) => (
              <div key={type} className="bg-white border border-stone-200 rounded-xl p-4">
                <p className="text-[10px] font-bold uppercase tracking-wider text-stone-500">{label}</p>
                <p className="font-serif font-black text-2xl text-stone-900 mt-1">{(report.byType[type] || 0).toLocaleString()}</p>
              </div>
            ))}
          </div>

          <div className="bg-white border border-stone-200 rounded-2xl p-5">
            <div className="flex items-center justify-between border-b border-stone-100 pb-3 mb-4">
              <h3 className="font-serif font-bold text-sm text-stone-900 flex items-center gap-2"><BarChart2 className="w-4 h-4" /> Events per day — {report.window} window</h3>
              <span className="text-[10px] uppercase font-bold text-stone-400">{report.total.toLocaleString()} total in window</span>
            </div>
            {report.byDay.length === 0 ? (
              <p className="py-6 text-center text-xs text-stone-400 italic">No events recorded in this window.</p>
            ) : (
              <div className="flex items-end gap-1 h-32" role="img" aria-label="Daily event counts">
                {report.byDay.map((d) => (
                  <div key={d.day} className="flex-1 flex flex-col items-center justify-end gap-1 min-w-0" title={`${d.day}: ${d.count} events`}>
                    <div className="w-full bg-red-700/80 hover:bg-red-700 rounded-t" style={{ height: `${Math.max(4, (d.count / maxDay) * 100)}%` }} />
                    <span className="text-[8px] text-stone-500 truncate w-full text-center">{d.day.slice(5)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-white border border-stone-200 rounded-2xl p-5">
            <h3 className="font-serif font-bold text-sm text-stone-900 border-b border-stone-100 pb-3 mb-2">Most recent events</h3>
            {report.recentEvents.length === 0 ? (
              <p className="py-6 text-center text-xs text-stone-400 italic">Nothing recorded yet.</p>
            ) : (
              <ul className="divide-y divide-stone-100">
                {report.recentEvents.map((e) => (
                  <li key={e.id} className="py-2.5 flex items-center justify-between gap-2 text-xs">
                    <span className="font-bold text-stone-800 uppercase text-[10px] tracking-wider">{e.type}</span>
                    <span className="text-stone-500 truncate min-w-0">{e.entityId || '—'}</span>
                    <span className="text-stone-400 shrink-0">{new Date(e.createdAt).toLocaleString()}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
};
