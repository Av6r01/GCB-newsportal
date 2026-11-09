/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phase 10: Taxonomy management — categories/subcategories (nested, full CRUD)
 * and reader-facing tags/topics, against the existing /api/categories and
 * /api/tags permissioned endpoints.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { RefreshCw, FolderTree, Tags, Plus, Trash2, Pencil } from 'lucide-react';
import { AdminPanelHeader, ApiErrorBanner, adminApi, AdminApiError } from './adminApi';

interface Category {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  color?: string | null;
  parentId?: string | null;
  displayOrder?: number;
  children?: Category[];
}
interface Tag { id: string; name: string; slug: string; description?: string | null }

const slugify = (v: string) => v.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

export const CmsTaxonomy: React.FC<{ token: string }> = ({ token }) => {
  const api = adminApi(token);
  const [tab, setTab] = useState<'categories' | 'tags'>('categories');
  const [categories, setCategories] = useState<Category[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<AdminApiError | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Category | null>(null);

  // category form state
  const [catName, setCatName] = useState('');
  const [catDescription, setCatDescription] = useState('');
  const [catParent, setCatParent] = useState('');
  const [catColor, setCatColor] = useState('#990000');
  // tag form state
  const [tagName, setTagName] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [cats, tgs] = await Promise.all([
        api.get<Category[]>('/api/categories'),
        api.get<Tag[]>('/api/tags'),
      ]);
      setCategories(cats || []);
      setTags(Array.isArray(tgs) ? tgs : []);
    } catch (err) {
      setError(err as AdminApiError);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { void load(); }, []);

  const resetCatForm = () => { setCatName(''); setCatDescription(''); setCatParent(''); setCatColor('#990000'); setEditing(null); };
  const startEdit = (c: Category) => { setEditing(c); setCatName(c.name); setCatDescription(c.description || ''); setCatParent(c.parentId || ''); setCatColor(c.color || '#990000'); };

  const saveCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setBusy(true);
    try {
      const payload = { name: catName.trim(), description: catDescription.trim(), color: catColor, parentId: catParent || null };
      if (editing) await api.put(`/api/categories/${editing.id}`, payload);
      else await api.post('/api/categories', payload);
      resetCatForm();
      await load();
    } catch (err: any) {
      setFormError(err?.message || 'Could not save the category.');
    } finally { setBusy(false); }
  };

  const deleteCategory = async (c: Category) => {
    setBusy(true); setError(null);
    try { await api.del(`/api/categories/${c.id}`); resetCatForm(); await load(); }
    catch (err: any) { setError(err); }
    finally { setBusy(false); }
  };

  const createTag = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setBusy(true);
    try {
      await api.post('/api/tags', { name: tagName.trim(), slug: slugify(tagName) });
      setTagName('');
      await load();
    } catch (err: any) {
      setFormError(err?.message || 'Could not create the tag.');
    } finally { setBusy(false); }
  };

  const deleteTag = async (t: Tag) => {
    setBusy(true); setError(null);
    try { await api.del(`/api/tags/${t.id}`); await load(); }
    catch (err: any) { setError(err); }
    finally { setBusy(false); }
  };

  const flatCats = categories;
  const parentName = (id?: string | null) => flatCats.find((c) => c.id === id)?.name;

  return (
    <div className="space-y-6" data-admin-screen="taxonomy">
      <AdminPanelHeader title="Categories & Topics" description="Section tree (public sidebar navigation) and reader-facing topic tags." >
        <div className="flex rounded-lg border border-stone-200 overflow-hidden" role="tablist">
          <button onClick={() => setTab('categories')} className={`px-3 py-1.5 text-xs font-semibold inline-flex items-center gap-1 ${tab === 'categories' ? 'bg-stone-900 text-white' : 'bg-white text-stone-600 hover:bg-stone-50'}`}>
            <FolderTree className="w-3.5 h-3.5" /> Categories
          </button>
          <button onClick={() => setTab('tags')} className={`px-3 py-1.5 text-xs font-semibold inline-flex items-center gap-1 border-l border-stone-200 ${tab === 'tags' ? 'bg-stone-900 text-white' : 'bg-white text-stone-600 hover:bg-stone-50'}`}>
            <Tags className="w-3.5 h-3.5" /> Topics
          </button>
          <button onClick={() => void load()} className="px-2.5 bg-white text-stone-600 hover:bg-stone-50 border-l border-stone-200" title="Refresh"><RefreshCw className="w-3.5 h-3.5" /></button>
        </div>
      </AdminPanelHeader>
      <ApiErrorBanner error={error} onRetry={() => void load()} />

      {tab === 'categories' ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <form onSubmit={saveCategory} className="bg-white border border-stone-200 rounded-2xl p-5 space-y-4" noValidate>
            <h3 className="font-serif font-bold text-sm text-stone-900">{editing ? `Edit: ${editing.name}` : 'New Section'}</h3>
            {formError && <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2" role="alert">{formError}</p>}
            <label className="text-xs font-semibold text-stone-700 flex flex-col gap-1">
              Name *
              <input value={catName} onChange={(e) => setCatName(e.target.value)} required maxLength={60}
                className="border border-stone-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-stone-800" />
            </label>
            <label className="text-xs font-semibold text-stone-700 flex flex-col gap-1">
              Parent section (leave empty for top-level)
              <select value={catParent} onChange={(e) => setCatParent(e.target.value)} className="border border-stone-300 rounded-lg px-3 py-2 text-sm">
                <option value="">— Top-level section —</option>
                {flatCats.filter((c) => c.id !== editing?.id).map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </label>
            <label className="text-xs font-semibold text-stone-700 flex flex-col gap-1">
              Description
              <input value={catDescription} onChange={(e) => setCatDescription(e.target.value)} maxLength={160}
                className="border border-stone-300 rounded-lg px-3 py-2 text-sm" />
            </label>
            <label className="text-xs font-semibold text-stone-700 flex flex-col gap-1">
              Accent color
              <input type="color" value={catColor} onChange={(e) => setCatColor(e.target.value)} className="h-9 rounded border border-stone-300" />
            </label>
            <div className="flex gap-2">
              <button type="submit" disabled={busy} className="bg-stone-900 hover:bg-stone-800 disabled:opacity-50 text-white font-semibold px-4 py-2 rounded-lg text-xs">
                {editing ? 'Save Changes' : 'Create Section'}
              </button>
              {editing && (
                <button type="button" onClick={resetCatForm} className="bg-stone-100 hover:bg-stone-200 text-stone-700 font-semibold px-4 py-2 rounded-lg text-xs">Cancel</button>
              )}
            </div>
          </form>

          <div className="lg:col-span-2 bg-white border border-stone-200 rounded-2xl p-5 space-y-2">
            <h3 className="font-serif font-bold text-sm text-stone-900 pb-2 border-b border-stone-100">Section tree ({categories.length})</h3>
            {loading ? <p className="py-6 text-center text-xs text-stone-400">Loading sections…</p> : (
              <ul className="divide-y divide-stone-100">
                {categories.map((c) => (
                  <li key={c.id} className="py-2.5 flex items-center justify-between gap-2 text-xs">
                    <div className="min-w-0">
                      <span className="inline-flex items-center gap-1.5 font-semibold text-stone-900">
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: c.color || '#990000' }} />
                        {c.name}
                      </span>
                      {c.parentId && <span className="text-stone-500 ml-2">↳ subcategory of {parentName(c.parentId) || 'unknown'}</span>}
                      <span className="text-stone-400 ml-2 font-mono">/{c.slug}</span>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <button onClick={() => startEdit(c)} title="Edit section" className="p-1.5 rounded hover:bg-stone-100 text-stone-600"><Pencil className="w-3.5 h-3.5" /></button>
                      <button onClick={() => void deleteCategory(c)} title="Delete section" disabled={busy} className="p-1.5 rounded hover:bg-red-50 text-red-700 disabled:opacity-40"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <form onSubmit={createTag} className="bg-white border border-stone-200 rounded-2xl p-5 space-y-4" noValidate>
            <h3 className="font-serif font-bold text-sm text-stone-900">New Topic Tag</h3>
            {formError && <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2" role="alert">{formError}</p>}
            <label className="text-xs font-semibold text-stone-700 flex flex-col gap-1">
              Display name *
              <input value={tagName} onChange={(e) => setTagName(e.target.value)} required maxLength={48}
                className="border border-stone-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-stone-800" />
            </label>
            <p className="text-[10px] text-stone-500">URL becomes <code>/topic/{tagName ? slugify(tagName) || 'slug' : 'slug'}</code></p>
            <button type="submit" disabled={busy} className="bg-stone-900 hover:bg-stone-800 disabled:opacity-50 text-white font-semibold px-4 py-2 rounded-lg text-xs inline-flex items-center gap-1">
              <Plus className="w-3.5 h-3.5" /> Create Topic
            </button>
          </form>

          <div className="lg:col-span-2 bg-white border border-stone-200 rounded-2xl p-5 space-y-2">
            <h3 className="font-serif font-bold text-sm text-stone-900 pb-2 border-b border-stone-100">Topics ({tags.length})</h3>
            {loading ? <p className="py-6 text-center text-xs text-stone-400">Loading topics…</p> : tags.length === 0 ? (
              <p className="py-6 text-center text-xs text-stone-400 italic">No topic tags yet.</p>
            ) : (
              <ul className="divide-y divide-stone-100">
                {tags.map((t) => (
                  <li key={t.id} className="py-2.5 flex items-center justify-between gap-2 text-xs">
                    <span className="font-semibold text-stone-900">{t.name} <span className="text-stone-400 font-mono">/{t.slug}</span></span>
                    <button onClick={() => void deleteTag(t)} title="Delete topic" disabled={busy} className="p-1.5 rounded hover:bg-red-50 text-red-700 disabled:opacity-40"><Trash2 className="w-3.5 h-3.5" /></button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
