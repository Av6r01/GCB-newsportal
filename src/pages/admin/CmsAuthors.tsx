/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phase 10: Author profiles & contributors — real staff writers list with
 * editable profiles (byline, designation, biography) via
 * PUT /api/authors/:userId/profile. Admins edit any profile; users edit their
 * own (server-enforced).
 */
import React, { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Save, UserRound } from 'lucide-react';
import { AdminPanelHeader, ApiErrorBanner, adminApi, AdminApiError } from './adminApi';

interface AuthorRecord {
  id: string; // user id
  name: string;
  email: string;
  role: string;
  isActive: boolean;
  profile: {
    byline?: string | null;
    designation?: string | null;
    biography?: string | null;
  };
}

export const CmsAuthors: React.FC<{ token: string; currentUserId: string }> = ({ token, currentUserId }) => {
  const api = adminApi(token);
  const [authors, setAuthors] = useState<AuthorRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<AdminApiError | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState({ byline: '', designation: '', biography: '' });
  const [busy, setBusy] = useState(false);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await api.get<AuthorRecord[]>('/api/authors');
      setAuthors(Array.isArray(list) ? list : []);
    } catch (err) {
      setError(err as AdminApiError);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { void load(); }, []);

  const startEdit = (a: AuthorRecord) => {
    setEditingId(a.id);
    setDraft({ byline: a.profile?.byline || '', designation: a.profile?.designation || '', biography: a.profile?.biography || '' });
    setSavedNotice(null);
  };

  const save = async (author: AuthorRecord) => {
    setBusy(true); setError(null);
    try {
      await api.put(`/api/authors/${author.id}/profile`, {
        byline: draft.byline || undefined,
        designation: draft.designation || undefined,
        biography: draft.biography || undefined,
      });
      setEditingId(null);
      setSavedNotice(`Profile saved for ${author.name}.`);
      await load();
    } catch (err: any) { setError(err); }
    finally { setBusy(false); }
  };

  const canEdit = (a: AuthorRecord) => a.id === currentUserId;

  return (
    <div className="space-y-6" data-admin-screen="authors">
      <AdminPanelHeader title="Author Profiles & Contributors" description="Masthead bios shown on public author pages (/author/<id>). Profiles you own are editable here.">
        <button onClick={() => void load()} className="text-xs font-semibold text-stone-600 hover:text-stone-900 inline-flex items-center gap-1" title="Refresh">
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </button>
      </AdminPanelHeader>
      <ApiErrorBanner error={error} onRetry={() => void load()} />
      {savedNotice && <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded p-2" role="status">{savedNotice}</p>}

      <div className="bg-white border border-stone-200 rounded-2xl p-5 space-y-3">
        {loading ? (
          <p className="py-8 text-center text-xs text-stone-400">Loading masthead…</p>
        ) : authors.length === 0 ? (
          <p className="py-8 text-center text-xs text-stone-400 italic">No author accounts exist yet.</p>
        ) : (
          <ul className="space-y-3">
            {authors.map((a) => (
              <li key={a.id} className="border border-stone-200 rounded-xl p-4 space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-full bg-stone-900 text-white flex items-center justify-center text-xs font-bold uppercase shrink-0">
                      {a.name?.charAt(0) || 'A'}
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-sm text-stone-900 truncate flex items-center gap-2">
                        <UserRound className="w-3.5 h-3.5 text-stone-400" /> {a.name}
                        <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-stone-100 text-stone-600 shrink-0">{a.role}</span>
                        {!a.isActive && <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-stone-200 text-stone-500 shrink-0">Disabled</span>}
                      </p>
                      <p className="text-[11px] text-stone-500 truncate">{a.profile?.byline || a.profile?.designation || 'No profile bio set'}</p>
                    </div>
                  </div>
                  {canEdit(a) ? (
                    editingId === a.id ? (
                      <div className="flex gap-2 shrink-0">
                        <button onClick={() => void save(a)} disabled={busy} className="text-xs font-semibold bg-stone-900 text-white px-3 py-1.5 rounded-lg inline-flex items-center gap-1 disabled:opacity-50"><Save className="w-3.5 h-3.5" /> Save</button>
                        <button onClick={() => setEditingId(null)} disabled={busy} className="text-xs font-semibold bg-stone-100 text-stone-700 px-3 py-1.5 rounded-lg">Cancel</button>
                      </div>
                    ) : (
                      <button onClick={() => startEdit(a)} className="text-xs font-semibold text-red-700 hover:underline shrink-0">Edit Profile</button>
                    )
                  ) : (
                    <span className="text-[10px] text-stone-400 italic shrink-0">Profile of another user — ask an admin</span>
                  )}
                </div>
                {editingId === a.id && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2 border-t border-stone-100">
                    <label className="text-xs font-semibold text-stone-700 flex flex-col gap-1">Byline
                      <input value={draft.byline} onChange={(e) => setDraft({ ...draft, byline: e.target.value })} maxLength={120}
                        placeholder="e.g. Senior Economics Correspondent" className="border border-stone-300 rounded-lg px-3 py-2 text-sm" />
                    </label>
                    <label className="text-xs font-semibold text-stone-700 flex flex-col gap-1">Designation
                      <input value={draft.designation} onChange={(e) => setDraft({ ...draft, designation: e.target.value })} maxLength={80}
                        className="border border-stone-300 rounded-lg px-3 py-2 text-sm" />
                    </label>
                    <label className="md:col-span-2 text-xs font-semibold text-stone-700 flex flex-col gap-1">Biography
                      <textarea value={draft.biography} onChange={(e) => setDraft({ ...draft, biography: e.target.value })} rows={3} maxLength={1200}
                        className="border border-stone-300 rounded-lg px-3 py-2 text-sm" />
                    </label>
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
