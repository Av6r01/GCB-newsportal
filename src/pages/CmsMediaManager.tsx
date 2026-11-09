/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import {
  Image as ImageIcon,
  Upload,
  Search,
  Trash2,
  Crosshair,
  AlertCircle,
  FileText,
  ArrowLeft,
  RefreshCw,
  Link as LinkIcon,
  Layers,
  ShieldAlert,
  CheckCircle2,
} from 'lucide-react';

interface CmsMediaManagerProps {
  token: string;
  onBack: () => void;
}

export const CmsMediaManager: React.FC<CmsMediaManagerProps> = ({ token, onBack }) => {
  const [assets, setAssets] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedAsset, setSelectedAsset] = useState<any | null>(null);

  // Edit Metadata Fields
  const [caption, setCaption] = useState('');
  const [credit, setCredit] = useState('');
  const [altText, setAltText] = useState('');
  const [focalX, setFocalX] = useState(50);
  const [focalY, setFocalY] = useState(50);

  // Upload Modal State
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadMode, setUploadMode] = useState<'file' | 'url'>('file');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadUrl, setUploadUrl] = useState('');
  const [uploadUrlMimeType, setUploadUrlMimeType] = useState('');
  const [uploadFilename, setUploadFilename] = useState('');
  const [uploadCredit, setUploadCredit] = useState('');
  const [uploadCaption, setUploadCaption] = useState('');

  // Replace File Modal State
  const [showReplaceModal, setShowReplaceModal] = useState(false);
  const [replaceFile, setReplaceFile] = useState<File | null>(null);

  // Deletion Blocking Safeguard Modal
  const [blockedDeletionData, setBlockedDeletionData] = useState<{
    assetId: string;
    count: number;
    dependentArticles: Array<{ id: string; title: string; slug: string; status: string }>;
  } | null>(null);
  const [replacementTargetId, setReplacementTargetId] = useState('');

  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  // Phase 11: which storage driver is REALLY active (never asserted — reported).
  const [storageInfo, setStorageInfo] = useState<{ driver: string; active?: any; variantPolicy?: any; visibility?: string } | null>(null);

  useEffect(() => {
    fetchMediaAssets();
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/admin/storage', { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (!cancelled) setStorageInfo(data); })
      .catch(() => { if (!cancelled) setStorageInfo(null); });
    return () => { cancelled = true; };
  }, [token]);

  const fetchMediaAssets = async () => {
    setLoading(true);
    try {
      const q = search ? `?search=${encodeURIComponent(search)}` : '';
      const res = await fetch(`/api/media${q}`);
      const data = await res.json();
      if (Array.isArray(data)) {
        setAssets(data);
      }
    } catch (err: any) {
      setErrorMessage('Failed to load media assets');
    } finally {
      setLoading(false);
    }
  };

  const handleSelectAsset = (asset: any) => {
    setSelectedAsset(asset);
    setCaption(asset.caption || '');
    setCredit(asset.credit || '');
    setAltText(asset.altText || '');
    setFocalX(asset.focalX !== undefined ? asset.focalX : 50);
    setFocalY(asset.focalY !== undefined ? asset.focalY : 50);
  };

  const handleFocalClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.round(((e.clientX - rect.left) / rect.width) * 100);
    const y = Math.round(((e.clientY - rect.top) / rect.height) * 100);
    setFocalX(x);
    setFocalY(y);
  };

  const handleUpdateAsset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAsset) return;

    setLoading(true);
    setErrorMessage('');
    setSuccessMessage('');

    try {
      const res = await fetch(`/api/media/${selectedAsset.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          focalX,
          focalY,
          caption,
          credit,
          altText,
        }),
      });

      const data = await res.json();
      if (res.ok) {
        setSuccessMessage('Media asset metadata updated successfully');
        fetchMediaAssets();
      } else {
        setErrorMessage(data.error || 'Failed to update asset');
      }
    } catch (err: any) {
      setErrorMessage(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteAsset = async (id: string, forceReplacementId?: string) => {
    setLoading(true);
    setErrorMessage('');
    setSuccessMessage('');

    try {
      const url = forceReplacementId
        ? `/api/media/${id}?replacementId=${encodeURIComponent(forceReplacementId)}`
        : `/api/media/${id}`;

      const res = await fetch(url, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });

      const data = await res.json();

      if (res.status === 409 && data.referenced) {
        // Referral blocking triggered
        setBlockedDeletionData({
          assetId: id,
          count: data.count,
          dependentArticles: data.dependentArticles || [],
        });
        setLoading(false);
        return;
      }

      if (res.ok) {
        setSuccessMessage('Media asset deleted successfully');
        setSelectedAsset(null);
        setBlockedDeletionData(null);
        fetchMediaAssets();
      } else {
        setErrorMessage(data.error || 'Cannot delete media asset');
      }
    } catch (err: any) {
      setErrorMessage(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleUploadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMessage('');
    setSuccessMessage('');

    try {
      if (uploadMode === 'file') {
        if (!uploadFile) {
          setErrorMessage('Please choose a file to upload');
          setLoading(false);
          return;
        }

        const formData = new FormData();
        formData.append('file', uploadFile);
        formData.append('caption', uploadCaption);
        formData.append('credit', uploadCredit);

        const res = await fetch('/api/media/file-upload', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
          },
          body: formData,
        });

        const data = await res.json();
        if (res.ok) {
          setSuccessMessage(`File "${data.filename}" uploaded successfully!`);
          setShowUploadModal(false);
          setUploadFile(null);
          fetchMediaAssets();
        } else {
          setErrorMessage(data.error || 'Upload failed validation');
        }
      } else {
        if (!uploadUrl) return;
        if (!uploadUrlMimeType) {
          setErrorMessage('Declare the real content type of the external asset (the server no longer invents image/jpeg).');
          setLoading(false);
          return;
        }
        const res = await fetch('/api/media', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            originalUrl: uploadUrl,
            mimeType: uploadUrlMimeType,
            filename: uploadFilename || undefined,
            caption: uploadCaption,
            credit: uploadCredit,
            focalX: 50,
            focalY: 50,
          }),
        });

        const data = await res.json();
        if (res.ok) {
          setSuccessMessage('Media asset created');
          setShowUploadModal(false);
          setUploadUrl('');
          fetchMediaAssets();
        } else {
          setErrorMessage(data.error || 'Upload failed');
        }
      }
    } catch (err: any) {
      setErrorMessage(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleReplaceSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAsset || !replaceFile) return;

    setLoading(true);
    setErrorMessage('');
    setSuccessMessage('');

    try {
      const formData = new FormData();
      formData.append('file', replaceFile);

      const res = await fetch(`/api/media/${selectedAsset.id}/replace-file`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: formData,
      });

      const data = await res.json();
      if (res.ok) {
        setSuccessMessage('Media file binary replaced seamlessly across all articles!');
        setShowReplaceModal(false);
        setReplaceFile(null);
        setSelectedAsset(data);
        fetchMediaAssets();
      } else {
        setErrorMessage(data.error || 'File replacement failed');
      }
    } catch (err: any) {
      setErrorMessage(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-20">
      {/* Header */}
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
            Media Asset Governance Pipeline
          </h2>
        </div>

        <button
          onClick={() => setShowUploadModal(true)}
          className="bg-stone-900 hover:bg-stone-800 text-white font-semibold px-4 py-2 rounded-xl text-xs flex items-center space-x-2 transition-colors shadow-xs"
        >
          <Upload className="w-3.5 h-3.5" />
          <span>Upload New Asset</span>
        </button>
      </div>

      {/* Notifications */}
      {errorMessage && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-xs font-medium flex items-center justify-between">
          <span className="flex items-center space-x-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{errorMessage}</span>
          </span>
          <button onClick={() => setErrorMessage('')}>✕</button>
        </div>
      )}
      {successMessage && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 px-4 py-3 rounded-xl text-xs font-medium flex items-center justify-between">
          <span className="flex items-center space-x-2">
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
            <span>{successMessage}</span>
          </span>
          <button onClick={() => setSuccessMessage('')}>✕</button>
        </div>
      )}

      {/* Main Grid: Assets & Inspector */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left Col: Asset Grid Browser */}
        <div className="lg:col-span-2 space-y-4">
          {/* Phase 11: the ACTIVELY used storage provider — reported, never asserted */}
          <div className="bg-white border border-stone-200 rounded-2xl p-4 shadow-2xs text-xs text-stone-600">
            <span className="text-[10px] font-bold uppercase tracking-widest text-stone-500">Storage</span>{' '}
            {storageInfo ? (
              <>
                <span className="ml-2 font-mono text-stone-900">{storageInfo.driver}</span>
                {storageInfo.active?.driver === 's3' ? (
                  <span className="ml-2 text-stone-500">bucket {storageInfo.active.bucket} · {storageInfo.active.region}{storageInfo.active.endpoint ? ' · endpoint' : ''}</span>
                ) : (
                  <span className="ml-2 text-stone-500">local directory backend (not S3)</span>
                )}
                <span className="ml-2 text-stone-500">visibility {storageInfo.visibility ?? '—'}</span>
              </>
            ) : (
              <span className="ml-2 text-stone-500">driver information unavailable</span>
            )}
          </div>
          <div className="bg-white border border-stone-200 rounded-2xl p-4 shadow-2xs">
            <div className="relative">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && fetchMediaAssets()}
                placeholder="Search by caption, credit, or filename..."
                className="w-full bg-stone-50 border border-stone-300 rounded-xl pl-9 pr-4 py-2 text-xs text-stone-900 focus:outline-none focus:border-stone-800"
              />
              <Search className="w-3.5 h-3.5 text-stone-400 absolute left-3 top-3" />
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            {assets.map((asset) => {
              const isSelected = selectedAsset?.id === asset.id;
              const isOrphan = (asset.usagesCount || 0) === 0;
              return (
                <div
                  key={asset.id}
                  onClick={() => handleSelectAsset(asset)}
                  className={`group bg-white rounded-2xl border-2 overflow-hidden cursor-pointer transition-all ${
                    isSelected
                      ? 'border-red-700 ring-2 ring-red-700/20 shadow-md'
                      : 'border-stone-200 hover:border-stone-400'
                  }`}
                >
                  <div className="aspect-video bg-stone-100 relative overflow-hidden">
                    <img
                      src={asset.originalUrl}
                      alt={asset.altText || ''}
                      style={{ objectPosition: `${asset.focalX}% ${asset.focalY}%` }}
                      className="w-full h-full object-cover transition-transform group-hover:scale-105"
                    />
                    <div className="absolute bottom-1 right-1 flex items-center space-x-1">
                      <span
                        className={`text-[9px] font-mono px-1.5 py-0.5 rounded-md backdrop-blur-xs font-semibold ${
                          isOrphan
                            ? 'bg-amber-500/90 text-white'
                            : 'bg-stone-900/80 text-white'
                        }`}
                      >
                        {isOrphan ? 'Orphaned' : `${asset.usagesCount} uses`}
                      </span>
                    </div>
                  </div>
                  <div className="p-3 text-xs space-y-1">
                    <p className="font-bold text-stone-900 truncate">{asset.filename}</p>
                    <p className="text-[10px] text-stone-500 truncate">{asset.credit || 'No credit'}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Col: Metadata, Focal Point & File Actions */}
        <div className="space-y-6">
          {selectedAsset ? (
            <div className="bg-white border border-stone-200 rounded-2xl p-6 space-y-6 shadow-2xs">
              <div className="flex items-center justify-between border-b border-stone-100 pb-3">
                <h3 className="font-serif font-bold text-base text-stone-900">
                  Asset Details & Focal Cropper
                </h3>
                <div className="flex items-center space-x-1">
                  <button
                    type="button"
                    onClick={() => setShowReplaceModal(true)}
                    className="text-stone-600 hover:text-stone-900 p-1.5 rounded-lg hover:bg-stone-100 transition-colors"
                    title="Replace Image File Binary"
                  >
                    <RefreshCw className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteAsset(selectedAsset.id)}
                    className="text-red-600 hover:text-red-800 p-1.5 rounded-lg hover:bg-red-50 transition-colors"
                    title="Delete Asset"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Interactive Focal Point Selector */}
              <div>
                <div className="flex items-center justify-between mb-1 text-xs">
                  <span className="font-semibold text-stone-700">Focal Point Alignment</span>
                  <span className="font-mono text-stone-500 text-[10px]">
                    X: {focalX}% | Y: {focalY}%
                  </span>
                </div>
                <div
                  onClick={handleFocalClick}
                  className="relative aspect-video rounded-xl overflow-hidden cursor-crosshair border border-stone-300 shadow-inner group"
                >
                  <img
                    src={selectedAsset.originalUrl}
                    alt=""
                    style={{ objectPosition: `${focalX}% ${focalY}%` }}
                    className="w-full h-full object-cover"
                  />
                  <div
                    style={{ left: `${focalX}%`, top: `${focalY}%` }}
                    className="absolute w-6 h-6 -ml-3 -mt-3 border-2 border-white rounded-full bg-red-600/90 pointer-events-none shadow-md flex items-center justify-center"
                  >
                    <div className="w-1.5 h-1.5 bg-white rounded-full" />
                  </div>
                </div>
              </div>

              {/* Dimensions & Usage Stats */}
              <div className="bg-stone-50 rounded-xl p-3 border border-stone-200 text-xs space-y-1">
                <div className="flex justify-between text-stone-600">
                  <span>Reserved Dimensions:</span>
                  <span className="font-mono font-bold text-stone-900">
                    {selectedAsset.width || 1200} × {selectedAsset.height || 675} px
                  </span>
                </div>
                <div className="flex justify-between text-stone-600">
                  <span>MIME / Format:</span>
                  <span className="font-mono text-stone-900 uppercase">{selectedAsset.mimeType}</span>
                </div>
                <div className="flex justify-between text-stone-600">
                  <span>Active Dispatches Linked:</span>
                  <span className="font-bold text-stone-900">{selectedAsset.usagesCount || 0}</span>
                </div>
              </div>

              <form onSubmit={handleUpdateAsset} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-stone-600 mb-1">
                    Photo Credit / Photographer
                  </label>
                  <input
                    type="text"
                    value={credit}
                    onChange={(e) => setCredit(e.target.value)}
                    className="w-full bg-stone-50 border border-stone-300 rounded-xl px-3 py-2 text-xs text-stone-900"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-stone-600 mb-1">
                    Caption Text
                  </label>
                  <textarea
                    rows={3}
                    value={caption}
                    onChange={(e) => setCaption(e.target.value)}
                    className="w-full bg-stone-50 border border-stone-300 rounded-xl p-3 text-xs text-stone-900 leading-relaxed"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-stone-600 mb-1">
                    Accessibility Alt Text
                  </label>
                  <input
                    type="text"
                    value={altText}
                    onChange={(e) => setAltText(e.target.value)}
                    className="w-full bg-stone-50 border border-stone-300 rounded-xl px-3 py-2 text-xs text-stone-900"
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-stone-900 hover:bg-stone-800 text-white font-semibold py-2.5 rounded-xl text-xs transition-colors shadow-xs"
                >
                  Save Asset Metadata
                </button>
              </form>
            </div>
          ) : (
            <div className="bg-white border border-stone-200 rounded-2xl p-8 text-center text-xs text-stone-400 italic space-y-2">
              <ImageIcon className="w-8 h-8 text-stone-300 mx-auto" />
              <p>Select a media asset to edit metadata, adjust crop focal point, or replace file binary.</p>
            </div>
          )}
        </div>
      </div>

      {/* Upload Modal Overlay */}
      {showUploadModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl shadow-2xl border border-stone-200 w-full max-w-lg p-6 space-y-4">
            <h3 className="font-serif font-bold text-lg text-stone-900 border-b border-stone-100 pb-2">
              Upload New Media Asset
            </h3>

            <div className="flex space-x-2 border-b border-stone-100 pb-2 text-xs font-semibold">
              <button
                type="button"
                onClick={() => setUploadMode('file')}
                className={`px-3 py-1.5 rounded-lg ${
                  uploadMode === 'file' ? 'bg-stone-900 text-white' : 'text-stone-600 bg-stone-100'
                }`}
              >
                Local Binary File (Magic Byte Verified)
              </button>
              <button
                type="button"
                onClick={() => setUploadMode('url')}
                className={`px-3 py-1.5 rounded-lg ${
                  uploadMode === 'url' ? 'bg-stone-900 text-white' : 'text-stone-600 bg-stone-100'
                }`}
              >
                External Asset URL
              </button>
            </div>

            <form onSubmit={handleUploadSubmit} className="space-y-4">
              {uploadMode === 'file' ? (
                <div>
                  <label className="block text-xs font-semibold text-stone-700 mb-1">
                    Select File (JPEG, PNG, WEBP, GIF, SVG - max 10MB)
                  </label>
                  <input
                    type="file"
                    required
                    accept="image/jpeg,image/png,image/webp,image/gif,image/svg+xml"
                    onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                    className="w-full bg-stone-50 border border-stone-300 rounded-xl p-2 text-xs text-stone-900 file:mr-3 file:py-1 file:px-3 file:rounded-lg file:border-0 file:bg-stone-200 file:text-xs font-semibold"
                  />
                </div>
              ) : (
                <div>
                  <label className="block text-xs font-semibold text-stone-700 mb-1">Image URL *</label>
                  <input
                    type="url"
                    required
                    value={uploadUrl}
                    onChange={(e) => setUploadUrl(e.target.value)}
                    placeholder="https://…/real-image-location.jpg"
                    className="w-full bg-stone-50 border border-stone-300 rounded-xl px-3 py-2 text-xs text-stone-900"
                  />
                  <label className="block text-xs font-semibold text-stone-700 mt-3 mb-1">Content type *</label>
                  <select
                    required
                    value={uploadUrlMimeType}
                    onChange={(e) => setUploadUrlMimeType(e.target.value)}
                    className="w-full bg-stone-50 border border-stone-300 rounded-xl px-3 py-2 text-xs text-stone-900"
                  >
                    <option value="">— select the real content type —</option>
                    <option value="image/jpeg">image/jpeg</option>
                    <option value="image/png">image/png</option>
                    <option value="image/webp">image/webp</option>
                    <option value="image/avif">image/avif</option>
                    <option value="image/gif">image/gif</option>
                    <option value="image/svg+xml">image/svg+xml</option>
                  </select>
                  <p className="text-[11px] text-stone-500 mt-1">
                    The server records only facts you provide — the former invented defaults (unsplash URL, 1920×1080, 512 KB) were removed.
                  </p>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1">Credit / Agency</label>
                <input
                  type="text"
                  value={uploadCredit}
                  onChange={(e) => setUploadCredit(e.target.value)}
                  placeholder="Global Chronicle Photo Wire"
                  className="w-full bg-stone-50 border border-stone-300 rounded-xl px-3 py-2 text-xs text-stone-900"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1">Caption</label>
                <textarea
                  rows={2}
                  value={uploadCaption}
                  onChange={(e) => setUploadCaption(e.target.value)}
                  placeholder="Description of the image..."
                  className="w-full bg-stone-50 border border-stone-300 rounded-xl p-3 text-xs text-stone-900"
                />
              </div>

              <div className="flex justify-end space-x-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowUploadModal(false)}
                  className="px-4 py-2 text-xs font-semibold text-stone-600 hover:bg-stone-100 rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="bg-stone-900 hover:bg-stone-800 text-white font-semibold px-4 py-2 text-xs rounded-xl shadow-xs"
                >
                  {loading ? 'Uploading...' : 'Upload & Verify'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Replace Binary File Modal Overlay */}
      {showReplaceModal && selectedAsset && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl shadow-2xl border border-stone-200 w-full max-w-md p-6 space-y-4">
            <h3 className="font-serif font-bold text-base text-stone-900 border-b border-stone-100 pb-2 flex items-center space-x-2">
              <RefreshCw className="w-4 h-4 text-red-700" />
              <span>Replace Image File Binary</span>
            </h3>

            <p className="text-xs text-stone-600 leading-relaxed">
              Replacing this file binary will update <strong className="text-stone-900">{selectedAsset.filename}</strong> across all {selectedAsset.usagesCount || 0} referencing dispatches instantly without breaking references or losing caption metadata.
            </p>

            <form onSubmit={handleReplaceSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1">
                  Select Replacement File (Magic Byte Verified)
                </label>
                <input
                  type="file"
                  required
                  accept="image/jpeg,image/png,image/webp,image/gif,image/svg+xml"
                  onChange={(e) => setReplaceFile(e.target.files?.[0] || null)}
                  className="w-full bg-stone-50 border border-stone-300 rounded-xl p-2 text-xs text-stone-900 file:mr-3 file:py-1 file:px-3 file:rounded-lg file:border-0 file:bg-stone-200 file:text-xs font-semibold"
                />
              </div>

              <div className="flex justify-end space-x-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowReplaceModal(false)}
                  className="px-4 py-2 text-xs font-semibold text-stone-600 hover:bg-stone-100 rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading || !replaceFile}
                  className="bg-red-700 hover:bg-red-800 disabled:opacity-50 text-white font-semibold px-4 py-2 text-xs rounded-xl shadow-xs"
                >
                  Execute In-Place Replace
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Referential Deletion Safeguard Modal */}
      {blockedDeletionData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/70 backdrop-blur-xs">
          <div className="bg-white rounded-2xl shadow-2xl border border-red-200 w-full max-w-lg p-6 space-y-5">
            <div className="flex items-center space-x-3 text-red-700">
              <ShieldAlert className="w-6 h-6 shrink-0" />
              <h3 className="font-serif font-bold text-lg">
                Deletion Blocked: Active Dispatch Reference
              </h3>
            </div>

            <p className="text-xs text-stone-700 leading-relaxed">
              This media asset cannot be deleted directly because it is actively embedded or set as cover image in <strong className="text-stone-950 font-bold">{blockedDeletionData.count} active newsroom dispatch(es)</strong>:
            </p>

            <div className="max-h-40 overflow-y-auto bg-stone-50 rounded-xl p-3 border border-stone-200 space-y-2">
              {blockedDeletionData.dependentArticles.map((art) => (
                <div key={art.id} className="text-xs flex items-center justify-between border-b border-stone-200 pb-1.5 last:border-0">
                  <span className="font-semibold text-stone-900 truncate pr-2">{art.title}</span>
                  <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 bg-stone-200 text-stone-700 rounded">
                    {art.status}
                  </span>
                </div>
              ))}
            </div>

            <div className="space-y-3 pt-2 border-t border-stone-100">
              <label className="block text-xs font-semibold text-stone-800">
                Choose Replacement Media Asset before deletion:
              </label>
              <select
                value={replacementTargetId}
                onChange={(e) => setReplacementTargetId(e.target.value)}
                className="w-full bg-stone-50 border border-stone-300 rounded-xl px-3 py-2 text-xs text-stone-900"
              >
                <option value="">-- Select Replacement Asset --</option>
                {assets
                  .filter((a) => a.id !== blockedDeletionData.assetId)
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.filename} ({a.credit || 'No credit'})
                    </option>
                  ))}
              </select>

              <div className="flex items-center justify-between pt-3">
                <button
                  type="button"
                  onClick={() => setBlockedDeletionData(null)}
                  className="px-4 py-2 text-xs font-semibold text-stone-600 hover:bg-stone-100 rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={!replacementTargetId || loading}
                  onClick={() => handleDeleteAsset(blockedDeletionData.assetId, replacementTargetId)}
                  className="bg-red-700 hover:bg-red-800 disabled:opacity-50 text-white font-semibold px-4 py-2 text-xs rounded-xl shadow-xs"
                >
                  Replace Target & Delete
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
