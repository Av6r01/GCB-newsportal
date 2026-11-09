/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phase 10: Scheduled-job monitoring & safe retry — real pipeline state
 * (GET /api/admin/scheduler/jobs) plus the atomic retry action
 * (POST /api/admin/scheduler/jobs/:articleId/retry), gated to article:publish.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { RefreshCw, RotateCcw, Info } from 'lucide-react';
import { AdminPanelHeader, ApiErrorBanner, adminApi, AdminApiError } from './adminApi';

interface PipelineState {
  daemon: { lastSweep: string; processedCount: number; reconciledCount: number; failedCount: number; status: string };
  jobs: Array<{ id: string; articleId: string; targetPublish: string | null; executedAt: string | null; status: string; failureReason: string | null; idempotencyKey: string; createdAt: string }>;
  stuck: Array<{ articleId: string; title: string; scheduledFor: string; overdueMinutes: number }>;
}

export const CmsJobs: React.FC<{ token: string; canPublish: boolean }> = ({ token, canPublish }) => {
  const api = adminApi(token);
  const [state, setState] = useState<PipelineState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<AdminApiError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<PipelineState>('/api/admin/scheduler/jobs');
      setState(data);
    } catch (err) {
      setError(err as AdminApiError);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { void load(); }, []);

  const retry = async (articleId: string, title: string) => {
    setBusyId(articleId); setError(null); setNotice(null);
    try {
      const r: any = await api.post(`/api/admin/scheduler/jobs/${articleId}/retry`, {});
      setNotice(r?.executed ? `"${title}" is now published.` : r?.message || 'Retry returned without publishing.');
      await load();
    } catch (err: any) {
      setError(err);
      await load();
    } finally { setBusyId(null); }
  };

  const statusColor: Record<string, string> = {
    EXECUTED: 'bg-emerald-100 text-emerald-700',
    QUEUED: 'bg-blue-100 text-blue-700',
    FAILED: 'bg-red-100 text-red-700',
  };

  return (
    <div className="space-y-6" data-admin-screen="jobs">
      <AdminPanelHeader title="Publishing Pipeline & Scheduled Jobs" description="Daemon health, per-article schedule rows and stuck-release recovery.">
        <button onClick={() => void load()} className="text-xs font-semibold text-stone-600 hover:text-stone-900 inline-flex items-center gap-1" title="Refresh"><RefreshCw className="w-3.5 h-3.5" /> Refresh</button>
      </AdminPanelHeader>
      <ApiErrorBanner error={error} onRetry={() => void load()} />
      {notice && <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded p-2" role="status">{notice}</p>}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white border border-stone-200 rounded-xl p-4">
          <p className="text-[10px] font-bold uppercase tracking-wider text-stone-500">Scheduler daemon</p>
          <p className={`font-serif font-black text-xl mt-1 ${state?.daemon.status === 'ACTIVE' ? 'text-emerald-700' : 'text-red-700'}`}>
            {state?.daemon.status || '—'}
          </p>
          <p className="text-[11px] text-stone-500">Last sweep {state ? new Date(state.daemon.lastSweep).toLocaleString() : '…'}</p>
        </div>
        <div className="bg-white border border-stone-200 rounded-xl p-4">
          <p className="text-[10px] font-bold uppercase tracking-wider text-stone-500">Processed (lifetime)</p>
          <p className="font-serif font-black text-xl mt-1 text-stone-900">{state?.daemon.processedCount || 0}</p>
          <p className="text-[11px] text-stone-500">{state?.daemon.reconciledCount || 0} reconciled overdue</p>
        </div>
        <div className="bg-white border border-stone-200 rounded-xl p-4">
          <p className="text-[10px] font-bold uppercase tracking-wider text-stone-500">Sweep failures (lifetime)</p>
          <p className={`font-serif font-black text-xl mt-1 ${(state?.daemon.failedCount || 0) > 0 ? 'text-red-700' : 'text-stone-900'}`}>{state?.daemon.failedCount || 0}</p>
          <p className="text-[11px] text-stone-500">{state?.stuck.length || 0} stuck release(s) right now</p>
        </div>
      </div>

      {state && state.stuck.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 space-y-3" data-testid="stuck-releases">
          <h3 className="font-serif font-bold text-sm text-amber-900 flex items-center gap-2"><Info className="w-4 h-4" /> Stuck scheduled releases (overdue &gt; 2 min)</h3>
          <ul className="space-y-2">
            {state.stuck.map((s) => (
              <li key={s.articleId} className="flex flex-col md:flex-row md:items-center justify-between gap-2 text-xs bg-white rounded-lg border border-amber-200 p-3">
                <div>
                  <p className="font-semibold text-stone-900 truncate max-w-md">{s.title}</p>
                  <p className="text-stone-500">{s.overdueMinutes} min overdue · target {new Date(s.scheduledFor).toLocaleString()}</p>
                </div>
                {canPublish ? (
                  <button onClick={() => void retry(s.articleId, s.title)} disabled={busyId === s.articleId}
                    className="text-xs font-semibold bg-amber-700 hover:bg-amber-800 disabled:opacity-50 text-white px-3 py-2 rounded-lg inline-flex items-center gap-1 shrink-0">
                    <RotateCcw className="w-3.5 h-3.5" /> {busyId === s.articleId ? 'Releasing…' : 'Retry Publish'}
                  </button>
                ) : (
                  <span className="text-[10px] text-stone-400 italic shrink-0">Requires publishing permission</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="bg-white border border-stone-200 rounded-2xl p-5 space-y-2">
        <h3 className="font-serif font-bold text-sm text-stone-900 pb-2 border-b border-stone-100">Schedule rows (newest 100)</h3>
        {loading ? (
          <p className="py-6 text-center text-xs text-stone-400">Loading schedule rows…</p>
        ) : !state || state.jobs.length === 0 ? (
          <p className="py-8 text-center text-xs text-stone-400 italic">No schedule rows recorded yet. Rows appear when articles are scheduled for timed release.</p>
        ) : (
          <ul className="divide-y divide-stone-100">
            {state.jobs.map((j) => (
              <li key={j.id} className="py-2.5 flex flex-col md:flex-row md:items-center justify-between gap-1 text-xs">
                <div className="min-w-0">
                  <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${statusColor[j.status] || 'bg-stone-100 text-stone-600'}`}>{j.status}</span>
                  <span className="font-mono text-[10px] text-stone-500 ml-2 truncate">{j.idempotencyKey}</span>
                </div>
                <div className="text-stone-500 shrink-0 md:text-right">
                  target {j.targetPublish ? new Date(j.targetPublish).toLocaleString() : '—'}
                  {j.executedAt && <> · executed {new Date(j.executedAt).toLocaleTimeString()}</>}
                  {j.failureReason && <span className="text-red-700 block md:inline md:ml-2">· {j.failureReason}</span>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};
