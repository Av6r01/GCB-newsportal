/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { ArrowLeft, Sparkles, Save, Send, History, Eye, Check, AlertCircle, Clock, Undo2, Image as ImageIcon } from 'lucide-react';
import { MediaLibraryModal } from '../components/MediaLibraryModal';
import DOMPurify from 'dompurify';

interface CmsArticleEditorProps {
  token: string;
  articleId?: string | null;
  onBack: () => void;
}

export const CmsArticleEditor: React.FC<CmsArticleEditorProps> = ({ token, articleId, onBack }) => {
  const [categories, setCategories] = useState<any[]>([]);
  const [tags, setTags] = useState<any[]>([]);
  const [authors, setAuthors] = useState<any[]>([]);

  // Metadata & Content state
  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [excerpt, setExcerpt] = useState('');
  const [content, setContent] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [priority, setPriority] = useState('NORMAL');
  const [status, setStatus] = useState('DRAFT');
  const [coverImage, setCoverImage] = useState('');
  const [imageCaption, setImageCaption] = useState('');
  const [imageCredit, setImageCredit] = useState('');
  const [sourceAttribution, setSourceAttribution] = useState('');
  const [seoTitle, setSeoTitle] = useState('');
  const [seoDescription, setSeoDescription] = useState('');
  const [socialImage, setSocialImage] = useState('');
  const [articleType, setArticleType] = useState('STANDARD');
  const [editorialNotes, setEditorialNotes] = useState('');
  const [scheduledFor, setScheduledFor] = useState('');
  const [videoUrl, setVideoUrl] = useState('');
  const [galleryAssets, setGalleryAssets] = useState<any[]>([]);
  const [revisions, setRevisions] = useState<any[]>([]);

  // UI state
  const [activeTab, setActiveTab] = useState<'content' | 'metadata' | 'seo' | 'history' | 'preview'>('content');
  const [loading, setLoading] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'unsaved'>('saved');
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiOutput, setAiOutput] = useState('');
  const [showMediaModal, setShowMediaModal] = useState(false);

  const autosaveTimerRef = useRef<any>(null);

  useEffect(() => {
    fetch('/api/categories')
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setCategories(data);
          if (data.length > 0 && !categoryId) setCategoryId(data[0].id);
        }
      });

    fetch('/api/tags')
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) setTags(data);
      });

    fetch('/api/authors')
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) setAuthors(data);
      });

    if (articleId) {
      fetch(`/api/articles`)
        .then((res) => res.json())
        .then((articles) => {
          const art = articles.find((a: any) => a.id === articleId);
          if (art) {
            setTitle(art.title || '');
            setSlug(art.slug || '');
            setExcerpt(art.excerpt || '');
            setContent(art.content || '');
            setCoverImage(art.coverImage || '');
            setCategoryId(art.categoryId || '');
            setPriority(art.priority || 'NORMAL');
            setStatus(art.status || 'DRAFT');
            setImageCaption(art.imageCaption || '');
            setImageCredit(art.imageCredit || '');
            setSourceAttribution(art.sourceAttribution || '');
            setSeoTitle(art.seoTitle || '');
            setSeoDescription(art.seoDescription || '');
            setSocialImage(art.socialImage || '');
            setArticleType(art.articleType || 'STANDARD');
            setEditorialNotes(art.editorialNotes || '');
            setVideoUrl(art.videoUrl || '');
            if (art.mediaAssets) setGalleryAssets(art.mediaAssets.map((ma: any) => ma.mediaAsset));
            if (art.scheduledFor) setScheduledFor(art.scheduledFor.slice(0, 16));
            if (art.revisions) setRevisions(art.revisions);
          }
        });
    }
  }, [articleId]);

  // 30-Second Debounced Autosave
  useEffect(() => {
    if (!articleId) return; // Only autosave existing drafts

    setSaveStatus('unsaved');
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);

    autosaveTimerRef.current = setTimeout(() => {
      handleSave(true);
    }, 30000);

    return () => {
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    };
  }, [title, excerpt, content, categoryId, status]);

  const handleSave = async (isAutosave = false) => {
    if (!isAutosave) setLoading(true);
    setSaveStatus('saving');
    setErrorMessage('');
    setSuccessMessage('');

    const payload = {
      title,
      slug: slug || title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''),
      excerpt,
      content,
      coverImage: coverImage || 'https://images.unsplash.com/photo-1585829365295-ab7cd400c167?w=1200',
      categoryId,
      priority,
      status,
      imageCaption,
      imageCredit,
      sourceAttribution,
      seoTitle,
      seoDescription,
      socialImage,
      articleType,
      editorialNotes,
      videoUrl,
      mediaAssets: galleryAssets.map(a => a.id),
      scheduledFor: scheduledFor ? new Date(scheduledFor).toISOString() : null,
      changeSummary: isAutosave ? 'Debounced autosave snapshot' : 'Editorial manual save',
    };

    try {
      const url = articleId ? `/api/articles/${articleId}` : '/api/articles';
      const method = articleId ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (res.ok) {
        setSaveStatus('saved');
        setSuccessMessage(isAutosave ? 'Autosaved successfully' : 'Changes saved successfully');
        if (!articleId && data.id) {
          // If newly created, switch to edit mode
          window.history.replaceState({}, '', `?id=${data.id}`);
        }
      } else {
        setSaveStatus('unsaved');
        setErrorMessage(data.error || 'Failed to save article');
      }
    } catch (err: any) {
      setSaveStatus('unsaved');
      setErrorMessage(err.message);
    } finally {
      if (!isAutosave) setLoading(false);
    }
  };

  const handleRestoreVersion = async (versionNumber: number) => {
    if (!window.confirm(`Are you sure you want to restore revision version ${versionNumber}?`)) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/articles/${articleId}/restore/${versionNumber}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (res.ok) {
        setTitle(data.title);
        setExcerpt(data.excerpt);
        setContent(data.content);
        setSuccessMessage(`Successfully restored version ${versionNumber}`);
        setActiveTab('content');
      } else {
        setErrorMessage(data.error || 'Failed to restore version');
      }
    } catch (err: any) {
      setErrorMessage(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleAiAssist = async (promptType: string) => {
    const textToAnalyze = content || excerpt || title;
    if (!textToAnalyze) {
      setErrorMessage('Please enter some article content first.');
      return;
    }

    setAiLoading(true);
    setAiOutput('');
    setErrorMessage('');

    try {
      const res = await fetch('/api/ai/assist', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ promptType, text: textToAnalyze }),
      });

      const data = await res.json();
      if (res.ok) {
        setAiOutput(data.result);
      } else {
        setErrorMessage(data.error || 'AI Assistant failed');
      }
    } catch (err: any) {
      setErrorMessage(err.message);
    } finally {
      setAiLoading(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6 pb-20">
      {/* Top Bar with Status & Tabs */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-stone-200 pb-4">
        <div className="flex items-center space-x-3">
          <button
            onClick={onBack}
            className="flex items-center space-x-2 text-stone-600 hover:text-stone-950 font-medium text-sm transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back</span>
          </button>
          <h2 className="font-serif font-bold text-xl text-stone-900">
            {articleId ? 'Edit Article Dispatch' : 'New Article Dispatch'}
          </h2>
        </div>

        <div className="flex items-center space-x-3">
          {/* Save Status Indicator */}
          <div className="flex items-center space-x-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-stone-100 text-stone-600">
            {saveStatus === 'saved' && (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-600" />
                <span className="text-emerald-700">All changes saved</span>
              </>
            )}
            {saveStatus === 'saving' && (
              <>
                <Clock className="w-3.5 h-3.5 text-amber-600 animate-spin" />
                <span className="text-amber-700">Saving...</span>
              </>
            )}
            {saveStatus === 'unsaved' && (
              <>
                <AlertCircle className="w-3.5 h-3.5 text-red-600" />
                <span className="text-red-700">Unsaved changes</span>
              </>
            )}
          </div>

          <button
            onClick={(e) => {
              e.preventDefault();
              handleSave(false);
            }}
            disabled={loading}
            className="bg-stone-900 hover:bg-stone-800 text-white font-semibold px-4 py-2 rounded-xl text-xs flex items-center space-x-2 transition-colors shadow-xs"
          >
            <Save className="w-3.5 h-3.5" />
            <span>Save Draft</span>
          </button>

          <button
            onClick={(e) => {
              e.preventDefault();
              setStatus('PUBLISHED');
              handleSave(false);
            }}
            disabled={loading}
            className="bg-red-700 hover:bg-red-800 text-white font-semibold px-4 py-2 rounded-xl text-xs flex items-center space-x-2 transition-colors shadow-xs"
          >
            <Send className="w-3.5 h-3.5" />
            <span>Publish Now</span>
          </button>
        </div>
      </div>

      {/* Notifications */}
      {errorMessage && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-xs font-medium flex items-center justify-between">
          <span>{errorMessage}</span>
          <button onClick={() => setErrorMessage('')} className="text-red-500 hover:text-red-800">✕</button>
        </div>
      )}
      {successMessage && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 px-4 py-3 rounded-xl text-xs font-medium flex items-center justify-between">
          <span>{successMessage}</span>
          <button onClick={() => setSuccessMessage('')} className="text-emerald-600 hover:text-emerald-900">✕</button>
        </div>
      )}

      {/* Editor Navigation Tabs */}
      <div className="flex space-x-2 border-b border-stone-200 text-xs font-semibold">
        <button
          onClick={() => setActiveTab('content')}
          className={`pb-3 px-4 border-b-2 transition-colors ${
            activeTab === 'content' ? 'border-red-700 text-red-700 font-bold' : 'border-transparent text-stone-600 hover:text-stone-900'
          }`}
        >
          Story Content & Body
        </button>
        <button
          onClick={() => setActiveTab('metadata')}
          className={`pb-3 px-4 border-b-2 transition-colors ${
            activeTab === 'metadata' ? 'border-red-700 text-red-700 font-bold' : 'border-transparent text-stone-600 hover:text-stone-900'
          }`}
        >
          Metadata & Media
        </button>
        <button
          onClick={() => setActiveTab('seo')}
          className={`pb-3 px-4 border-b-2 transition-colors ${
            activeTab === 'seo' ? 'border-red-700 text-red-700 font-bold' : 'border-transparent text-stone-600 hover:text-stone-900'
          }`}
        >
          SEO & Social Sharing
        </button>
        <button
          onClick={() => setActiveTab('history')}
          className={`pb-3 px-4 border-b-2 transition-colors ${
            activeTab === 'history' ? 'border-red-700 text-red-700 font-bold' : 'border-transparent text-stone-600 hover:text-stone-900'
          }`}
        >
          Revision History ({revisions.length})
        </button>
        <button
          onClick={() => setActiveTab('preview')}
          className={`pb-3 px-4 border-b-2 transition-colors flex items-center space-x-1 ${
            activeTab === 'preview' ? 'border-red-700 text-red-700 font-bold' : 'border-transparent text-stone-600 hover:text-stone-900'
          }`}
        >
          <Eye className="w-3.5 h-3.5" />
          <span>Live Preview</span>
        </button>
      </div>

      {/* Tab 1: Story Content & Body */}
      {activeTab === 'content' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-white border border-stone-200 rounded-2xl p-6 space-y-6 shadow-2xs">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-stone-600 mb-1">
                  Headline *
                </label>
                <input
                  type="text"
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Enter compelling news headline..."
                  className="w-full bg-stone-50 border border-stone-300 rounded-xl px-4 py-3 font-serif font-bold text-lg text-stone-900 focus:outline-none focus:border-stone-800"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-stone-600 mb-1">
                  URL Slug
                </label>
                <input
                  type="text"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  placeholder="custom-url-slug-here"
                  className="w-full bg-stone-50 border border-stone-300 rounded-xl px-4 py-2 text-xs font-mono text-stone-700 focus:outline-none focus:border-stone-800"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-stone-600 mb-1">
                  Standfirst / Summary *
                </label>
                <textarea
                  rows={3}
                  value={excerpt}
                  onChange={(e) => setExcerpt(e.target.value)}
                  placeholder="Provide a concise 1-2 sentence lead summary..."
                  className="w-full bg-stone-50 border border-stone-300 rounded-xl px-4 py-3 text-sm text-stone-900 focus:outline-none focus:border-stone-800 leading-relaxed"
                />
              </div>

              {articleType === 'VIDEO' && (
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-stone-600 mb-1">
                    YouTube Video URL
                  </label>
                  <input
                    type="url"
                    value={videoUrl}
                    onChange={(e) => setVideoUrl(e.target.value)}
                    placeholder="https://www.youtube.com/watch?v=..."
                    className="w-full bg-stone-50 border border-stone-300 rounded-xl px-4 py-2 text-xs text-stone-900 focus:outline-none focus:border-stone-800"
                  />
                </div>
              )}

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-semibold uppercase tracking-wider text-stone-600">
                    Story Body (HTML / Structured Markdown) *
                  </label>
                  <div className="flex items-center space-x-2">
                    <button
                      type="button"
                      onClick={() => handleAiAssist('summary')}
                      disabled={aiLoading}
                      className="text-xs font-semibold text-purple-700 hover:text-purple-900 bg-purple-50 px-2.5 py-1 rounded-lg flex items-center space-x-1 transition-colors"
                    >
                      <Sparkles className="w-3 h-3" />
                      <span>AI Summary</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleAiAssist('headlines')}
                      disabled={aiLoading}
                      className="text-xs font-semibold text-indigo-700 hover:text-indigo-900 bg-indigo-50 px-2.5 py-1 rounded-lg flex items-center space-x-1 transition-colors"
                    >
                      <Sparkles className="w-3 h-3" />
                      <span>AI Headlines</span>
                    </button>
                  </div>
                </div>

                <textarea
                  rows={12}
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder="<p>Enter article paragraphs, headings, and quotes...</p>"
                  className="w-full bg-stone-50 border border-stone-300 rounded-xl p-4 font-mono text-xs text-stone-900 focus:outline-none focus:border-stone-800 leading-relaxed"
                />
              </div>

              {aiOutput && (
                <div className="p-4 bg-purple-50 border border-purple-200 rounded-xl space-y-2">
                  <div className="font-bold text-xs text-purple-900 uppercase tracking-wider flex items-center space-x-1">
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>Gemini AI Assistant Output</span>
                  </div>
                  <p className="text-xs text-purple-800 whitespace-pre-wrap leading-relaxed font-sans">{aiOutput}</p>
                </div>
              )}
            </div>
          </div>

          {/* Right Sidebar: Bureau & Publishing controls */}
          <div className="space-y-6">
            <div className="bg-white border border-stone-200 rounded-2xl p-6 space-y-4 shadow-2xs">
              <h3 className="font-serif font-bold text-sm text-stone-900 border-b border-stone-100 pb-2">
                Publishing Settings
              </h3>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-stone-600 mb-1">
                  Article Type
                </label>
                <select
                  value={articleType}
                  onChange={(e) => setArticleType(e.target.value)}
                  className="w-full bg-stone-50 border border-stone-300 rounded-xl px-3 py-2 text-xs font-medium text-stone-900"
                >
                  <option value="STANDARD">Standard News</option>
                  <option value="LIVE_BLOG">Live Blog</option>
                  <option value="VIDEO">Video</option>
                  <option value="PHOTO_GALLERY">Photo Gallery</option>
                  <option value="OPINION">Opinion</option>
                  <option value="EXPLAINER">Explainer</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-stone-600 mb-1">
                  Workflow Status
                </label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                  className="w-full bg-stone-50 border border-stone-300 rounded-xl px-3 py-2 text-xs font-medium text-stone-900"
                >
                  <option value="DRAFT">Draft</option>
                  <option value="IN_REVIEW">In Review</option>
                  <option value="SCHEDULED">Scheduled</option>
                  <option value="PUBLISHED">Published</option>
                  <option value="ARCHIVED">Archived</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-stone-600 mb-1">
                  News Bureau Category *
                </label>
                <select
                  value={categoryId}
                  onChange={(e) => setCategoryId(e.target.value)}
                  className="w-full bg-stone-50 border border-stone-300 rounded-xl px-3 py-2 text-xs font-medium text-stone-900"
                >
                  {categories.map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-stone-600 mb-1">
                  Priority Rank
                </label>
                <select
                  value={priority}
                  onChange={(e) => setPriority(e.target.value)}
                  className="w-full bg-stone-50 border border-stone-300 rounded-xl px-3 py-2 text-xs font-medium text-stone-900"
                >
                  <option value="NORMAL">Normal</option>
                  <option value="FEATURED">Featured</option>
                  <option value="BREAKING">Breaking Flash</option>
                  <option value="INVESTIGATIVE">Investigative</option>
                </select>
              </div>

              {status === 'SCHEDULED' && (
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-stone-600 mb-1">
                    Scheduled Publish Time
                  </label>
                  <input
                    type="datetime-local"
                    value={scheduledFor}
                    onChange={(e) => setScheduledFor(e.target.value)}
                    className="w-full bg-stone-50 border border-stone-300 rounded-xl px-3 py-2 text-xs text-stone-900"
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Tab 2: Metadata & Media */}
      {activeTab === 'metadata' && (
        <div className="bg-white border border-stone-200 rounded-2xl p-8 space-y-6 shadow-2xs max-w-3xl">
          <h3 className="font-serif font-bold text-lg text-stone-900 border-b border-stone-100 pb-3">
            Featured Media & Attribution
          </h3>

          <div className="space-y-4">
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-semibold uppercase tracking-wider text-stone-600">
                  Featured Image URL
                </label>
                <button
                  type="button"
                  onClick={() => setShowMediaModal(true)}
                  className="text-xs font-semibold text-red-700 hover:text-red-900 bg-red-50 px-2.5 py-1 rounded-lg flex items-center space-x-1 transition-colors"
                >
                  <ImageIcon className="w-3.5 h-3.5" />
                  <span>Browse Media Library</span>
                </button>
              </div>
              <input
                type="url"
                value={coverImage}
                onChange={(e) => setCoverImage(e.target.value)}
                placeholder="https://images.unsplash.com/photo-..."
                className="w-full bg-stone-50 border border-stone-300 rounded-xl px-4 py-2 text-xs text-stone-900"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-stone-600 mb-1">
                  Image Caption
                </label>
                <input
                  type="text"
                  value={imageCaption}
                  onChange={(e) => setImageCaption(e.target.value)}
                  placeholder="Delegates gathering at plenary hall..."
                  className="w-full bg-stone-50 border border-stone-300 rounded-xl px-4 py-2 text-xs text-stone-900"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-stone-600 mb-1">
                  Image Credit / Photographer
                </label>
                <input
                  type="text"
                  value={imageCredit}
                  onChange={(e) => setImageCredit(e.target.value)}
                  placeholder="Global Chronicle Photo Wire / Unsplash"
                  className="w-full bg-stone-50 border border-stone-300 rounded-xl px-4 py-2 text-xs text-stone-900"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-stone-600 mb-1">
                Source Attribution / Wire Agency
              </label>
              <input
                type="text"
                value={sourceAttribution}
                onChange={(e) => setSourceAttribution(e.target.value)}
                placeholder="Reuters / Associated Press / Special Correspondent"
                className="w-full bg-stone-50 border border-stone-300 rounded-xl px-4 py-2 text-xs text-stone-900"
              />
            </div>

            {articleType === 'PHOTO_GALLERY' && (
              <div className="space-y-3 pt-4 border-t border-stone-100">
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-semibold uppercase tracking-wider text-stone-600">
                    Photo Gallery Images (Drag-and-Drop Reordering)
                  </label>
                  <button
                    type="button"
                    onClick={() => setShowMediaModal(true)}
                    className="text-[10px] font-bold text-red-700 hover:text-red-900 bg-red-50 px-2 py-1 rounded transition-colors"
                  >
                    Add Images to Gallery
                  </button>
                </div>
                
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  {galleryAssets.map((asset, idx) => (
                    <div key={asset.id} className="relative group aspect-square rounded-lg overflow-hidden bg-stone-100 border border-stone-200">
                      <img src={asset.originalUrl || asset.url} alt="" className="w-full h-full object-cover" />
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                        <button
                          onClick={() => setGalleryAssets(prev => prev.filter(a => a.id !== asset.id))}
                          className="p-1.5 bg-red-600 text-white rounded-md hover:bg-red-700"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                      </div>
                      <div className="absolute top-1 left-1 bg-black/60 text-white text-[9px] px-1.5 py-0.5 rounded-full font-mono">
                        #{idx + 1}
                      </div>
                    </div>
                  ))}
                  {galleryAssets.length === 0 && (
                    <div className="col-span-full py-8 text-center border-2 border-dashed border-stone-200 rounded-xl text-stone-400 text-xs italic">
                      No gallery images selected. Use "Add Images" to populate.
                    </div>
                  )}
                </div>
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-stone-600 mb-1">
                Editorial Notes (Internal Only)
              </label>
              <textarea
                rows={3}
                value={editorialNotes}
                onChange={(e) => setEditorialNotes(e.target.value)}
                placeholder="Instructions or fact-checking notes for copy editors..."
                className="w-full bg-stone-50 border border-stone-300 rounded-xl p-3 text-xs text-stone-900"
              />
            </div>
          </div>
        </div>
      )}

      {/* Tab 3: SEO & Social Sharing */}
      {activeTab === 'seo' && (
        <div className="bg-white border border-stone-200 rounded-2xl p-8 space-y-6 shadow-2xs max-w-3xl">
          <h3 className="font-serif font-bold text-lg text-stone-900 border-b border-stone-100 pb-3">
            Search Engine Optimization & OpenGraph
          </h3>

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-stone-600 mb-1">
                SEO Title (Max 60 characters)
              </label>
              <input
                type="text"
                value={seoTitle}
                onChange={(e) => setSeoTitle(e.target.value)}
                placeholder={title}
                className="w-full bg-stone-50 border border-stone-300 rounded-xl px-4 py-2 text-xs text-stone-900"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-stone-600 mb-1">
                SEO Meta Description (Max 160 characters)
              </label>
              <textarea
                rows={2}
                value={seoDescription}
                onChange={(e) => setSeoDescription(e.target.value)}
                placeholder={excerpt}
                className="w-full bg-stone-50 border border-stone-300 rounded-xl p-3 text-xs text-stone-900"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-stone-600 mb-1">
                Social Sharing Card Image URL (OpenGraph / Twitter)
              </label>
              <input
                type="url"
                value={socialImage}
                onChange={(e) => setSocialImage(e.target.value)}
                placeholder={coverImage}
                className="w-full bg-stone-50 border border-stone-300 rounded-xl px-4 py-2 text-xs text-stone-900"
              />
            </div>
          </div>
        </div>
      )}

      {/* Tab 4: Revision History */}
      {activeTab === 'history' && (
        <div className="bg-white border border-stone-200 rounded-2xl p-8 space-y-6 shadow-2xs max-w-3xl">
          <h3 className="font-serif font-bold text-lg text-stone-900 border-b border-stone-100 pb-3">
            Immutable Audit Trail & Version History
          </h3>

          <div className="divide-y divide-stone-100">
            {revisions.length > 0 ? (
              revisions.map((rev: any) => (
                <div key={rev.id || rev.version} className="py-4 flex items-center justify-between gap-4">
                  <div>
                    <div className="flex items-center space-x-2">
                      <span className="font-bold text-xs text-stone-900">Version {rev.version}</span>
                      <span className="text-[10px] text-stone-400">•</span>
                      <span className="text-xs text-stone-500">
                        {new Date(rev.createdAt).toLocaleString()}
                      </span>
                    </div>
                    <p className="text-xs font-serif font-semibold text-stone-800 mt-0.5">{rev.title}</p>
                    <p className="text-[11px] text-stone-500 italic mt-0.5">{rev.changeSummary || 'Editorial update'}</p>
                  </div>

                  <button
                    onClick={() => handleRestoreVersion(rev.version)}
                    className="bg-stone-100 hover:bg-stone-200 text-stone-700 text-xs font-semibold px-3 py-1.5 rounded-lg flex items-center space-x-1.5 transition-colors"
                  >
                    <Undo2 className="w-3.5 h-3.5" />
                    <span>Restore Version</span>
                  </button>
                </div>
              ))
            ) : (
              <div className="py-12 text-center text-xs text-stone-400 italic">
                No revision history snapshots recorded yet for this dispatch.
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab 5: Live Preview */}
      {activeTab === 'preview' && (
        <div className="bg-white border border-stone-200 rounded-2xl p-8 space-y-6 shadow-lg max-w-3xl mx-auto font-serif">
          <div className="text-center space-y-3 pb-6 border-b border-stone-200">
            <span className="bg-red-100 text-red-800 text-[10px] font-bold uppercase tracking-widest px-3 py-1 rounded-full">
              Live Preview Mode
            </span>
            <h1 className="text-3xl sm:text-4xl font-black text-stone-900 leading-tight">
              {title || 'Untitled Headline'}
            </h1>
            <p className="text-base text-stone-600 font-sans italic max-w-xl mx-auto">
              {excerpt || 'Standfirst summary will appear here...'}
            </p>
          </div>

          {coverImage && (
            <div className="space-y-2">
              <img src={coverImage} alt="" className="w-full h-80 object-cover rounded-xl shadow-md" />
              {imageCaption && (
                <p className="text-xs text-stone-500 text-center font-sans">
                  {imageCaption} {imageCredit ? `— Photo: ${imageCredit}` : ''}
                </p>
              )}
            </div>
          )}

          <div
            className="prose prose-stone max-w-none font-sans text-stone-800 leading-relaxed pt-4 space-y-4"
            dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(content || '<p>Story content will appear here...</p>', { USE_PROFILES: { html: true } }) }}
          />
        </div>
      )}

      {/* Media Asset Picker Modal */}
      <MediaLibraryModal
        isOpen={showMediaModal}
        token={token}
        onClose={() => setShowMediaModal(false)}
        multiSelect={articleType === 'PHOTO_GALLERY' && activeTab === 'metadata'}
        onSelectMedia={(media) => {
          if (articleType === 'PHOTO_GALLERY') {
            setGalleryAssets(prev => [...prev, media]);
          } else {
            setCoverImage(media.url);
            if (media.caption) setImageCaption(media.caption);
            if (media.credit) setImageCredit(media.credit);
          }
        }}
        onSelectMultipleMedia={(mediaList) => {
          if (articleType === 'PHOTO_GALLERY') {
            setGalleryAssets(prev => [...prev, ...mediaList]);
          }
        }}
      />
    </div>
  );
};
