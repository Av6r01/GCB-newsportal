/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phase 10: Staff accounts, role assignment & access restrictions — real
 * listing (GET /api/admin/users), account creation (POST), role change
 * (PUT /api/admin/users/:id/role; server blocks escalation) and
 * activate/deactivate (PUT /api/admin/users/:id/status).
 */
import React, { useState, useEffect, useCallback } from 'react';
import { RefreshCw, UserPlus, Power } from 'lucide-react';
import { AdminPanelHeader, ApiErrorBanner, adminApi, AdminApiError } from './adminApi';

interface StaffUser {
  id: string;
  email: string;
  name: string;
  role: string;
  isActive: boolean;
  createdAt: string;
}

const ASSIGNABLE_ROLES = [
  'ADMIN', 'MANAGING_EDITOR', 'SECTION_EDITOR', 'COPY_EDITOR',
  'REPORTER', 'PHOTOGRAPHER', 'VIDEO_EDITOR', 'ADVERTISING_MANAGER', 'ANALYST',
];

export const CmsStaff: React.FC<{ token: string }> = ({ token }) => {
  const api = adminApi(token);
  const [users, setUsers] = useState<StaffUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<AdminApiError | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [draft, setDraft] = useState({ email: '', name: '', role: 'REPORTER', password: '' });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await api.get<StaffUser[]>('/api/admin/users');
      setUsers(Array.isArray(list) ? list : []);
    } catch (err) {
      setError(err as AdminApiError);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { void load(); }, []);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null); setNotice(null); setBusy(true);
    try {
      await api.post('/api/admin/users', draft);
      setDraft({ email: '', name: '', role: 'REPORTER', password: '' });
      setShowCreate(false);
      setNotice('Staff account created.');
      await load();
    } catch (err: any) {
      setFormError(err?.message || 'Could not create the account.');
    } finally { setBusy(false); }
  };

  const changeRole = async (user: StaffUser, role: string) => {
    setBusy(true); setError(null); setNotice(null);
    try {
      await api.put(`/api/admin/users/${user.id}/role`, { role });
      setNotice(`${user.name} is now ${role}.`);
      await load();
    } catch (err: any) { setError(err); await load(); }
    finally { setBusy(false); }
  };

  const toggleActive = async (user: StaffUser) => {
    setBusy(true); setError(null); setNotice(null);
    try {
      await api.put(`/api/admin/users/${user.id}/status`, { isActive: !user.isActive });
      setNotice(`${user.name} ${user.isActive ? 'deactivated' : 'activated'}.`);
      await load();
    } catch (err: any) { setError(err); await load(); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-6" data-admin-screen="staff">
      <AdminPanelHeader title="Staff Accounts & Access" description="Role assignment applies immediately (session claims refresh on next sign-in).">
        <div className="flex items-center gap-2">
          <button onClick={() => setShowCreate((v) => !v)} className="bg-stone-900 hover:bg-stone-800 text-white text-xs font-semibold px-3 py-2 rounded-lg inline-flex items-center gap-1">
            <UserPlus className="w-3.5 h-3.5" /> New Staff Account
          </button>
          <button onClick={() => void load()} className="text-xs font-semibold text-stone-600 hover:text-stone-900 inline-flex items-center gap-1" title="Refresh"><RefreshCw className="w-3.5 h-3.5" /></button>
        </div>
      </AdminPanelHeader>
      <ApiErrorBanner error={error} onRetry={() => void load()} />
      {notice && <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded p-2" role="status">{notice}</p>}

      {showCreate && (
        <form onSubmit={create} className="bg-white border border-stone-200 rounded-2xl p-5 space-y-4" noValidate>
          <h3 className="font-serif font-bold text-sm text-stone-900">Create Staff Account</h3>
          {formError && <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2" role="alert">{formError}</p>}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="text-xs font-semibold text-stone-700 flex flex-col gap-1">Full name *
              <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} required maxLength={80} minLength={2}
                className="border border-stone-300 rounded-lg px-3 py-2 text-sm" />
            </label>
            <label className="text-xs font-semibold text-stone-700 flex flex-col gap-1">Email *
              <input type="email" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} required maxLength={254}
                className="border border-stone-300 rounded-lg px-3 py-2 text-sm" />
            </label>
            <label className="text-xs font-semibold text-stone-700 flex flex-col gap-1">Role *
              <select value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value })} className="border border-stone-300 rounded-lg px-3 py-2 text-sm">
                {ASSIGNABLE_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </label>
            <label className="text-xs font-semibold text-stone-700 flex flex-col gap-1">Temporary password * (min 10 chars)
              <input type="password" value={draft.password} onChange={(e) => setDraft({ ...draft, password: e.target.value })} required minLength={10} maxLength={128}
                className="border border-stone-300 rounded-lg px-3 py-2 text-sm" autoComplete="new-password" />
            </label>
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={busy} className="bg-stone-900 hover:bg-stone-800 disabled:opacity-50 text-white font-semibold px-4 py-2 rounded-lg text-xs">Create Account</button>
            <button type="button" onClick={() => setShowCreate(false)} className="bg-stone-100 hover:bg-stone-200 text-stone-700 font-semibold px-4 py-2 rounded-lg text-xs">Cancel</button>
          </div>
        </form>
      )}

      <div className="bg-white border border-stone-200 rounded-2xl p-5 space-y-1">
        {loading ? (
          <p className="py-8 text-center text-xs text-stone-400">Loading staff accounts…</p>
        ) : users.length === 0 ? (
          <p className="py-8 text-center text-xs text-stone-400 italic">No accounts.</p>
        ) : (
          <ul className="divide-y divide-stone-100">
            {users.map((u) => (
              <li key={u.id} className="py-3 flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-stone-900 truncate">{u.name} {!u.isActive && <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-stone-200 text-stone-500">Disabled</span>}</p>
                  <p className="text-[11px] text-stone-500">{u.email} · joined {new Date(u.createdAt).toLocaleDateString()}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <label className="text-[10px] font-bold uppercase text-stone-500 flex flex-col gap-1">
                    Role
                    <select value={u.role} onChange={(e) => void changeRole(u, e.target.value)} disabled={busy}
                      className="border border-stone-300 rounded-lg px-2 py-1.5 text-xs disabled:opacity-50">
                      {u.role === 'SUPER_ADMIN' ? <option value="SUPER_ADMIN">SUPER_ADMIN</option> : null}
                      {ASSIGNABLE_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                      <option value="READER" disabled={u.role !== 'READER'}>READER</option>
                    </select>
                  </label>
                  <button onClick={() => void toggleActive(u)} disabled={busy} title={u.isActive ? 'Deactivate account' : 'Activate account'}
                    className={`p-2 rounded-lg border disabled:opacity-50 ${u.isActive ? 'text-stone-600 border-stone-200 hover:bg-stone-50' : 'text-emerald-700 border-emerald-200 hover:bg-emerald-50'}`}>
                    <Power className="w-3.5 h-3.5" />
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
