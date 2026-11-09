/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { Image as ImageIcon, Upload, Check, X, Search, AlertCircle, RefreshCw } from 'lucide-react';

interface MediaAsset {
  id: string;
  filename: string;
  originalUrl: string;
  cdnUrl?: string;
  mimeType: string;
  sizeBytes: number;
  width?: number;
  height?: number;
  altText?: string;
  caption?: string;
  credit?: string;
  focalX: number;
  focalY: number;
  assetType: string;
  usagesCount?: number;
  createdAt: string;
}

interface MediaLibraryModalProps {
  isOpen: boolean;
  token: string;
  onClose: () => void;
  onSelectMedia: (media: { id: string; url: string; caption?: string; credit?: string; altText?: string }) => void;
  onSelectMultipleMedia?: (mediaList: Array<{ id: string; url: string; caption?: string; credit?: string; altText?: string }>) => void;
  multiSelect?: boolean;
}

export const MediaLibraryModal: React.FC<MediaLibraryModalProps> = ({
  isOpen,
  token,
  onClose,
  onSelectMedia,
  onSelectMultipleMedia,
  multiSelect = false,
}) => {
  const [assets, setAssets] = useState<MediaAsset[]>([]);
  const [selectedAsset, setSelectedAsset] = useState<MediaAsset | null>(null);
  const [selectedAssetsMulti, setSelectedAssetsMulti] = useState<MediaAsset[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<'library' | 'upload'>('library');

  // Upload state
  const [uploadMode, setUploadMode] = useState<'file' | 'url'>('file');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadUrl, setUploadUrl] = useState('');
  const [uploadUrlMimeType, setUploadUrlMimeType] = useState('');
  const [filename, setFilename] = useState('');
  const [caption, setCaption] = useState('');
  const [credit, setCredit] = useState('');
  const [altText, setAltText] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  useEffect(() => {
    if (isOpen) {
      fetchMediaAssets();
    }
  }, [isOpen]);

  const fetchMediaAssets = async () => {
    setLoading(true);
    try {
      const query = search ? `?search=${encodeURIComponent(search)}` : '';
      const res = await fetch(`/api/media${query}`);
      const data = await res.json();
      if (Array.isArray(data)) {
        setAssets(data);
      }
    } catch (err: any) {
      console.error('Failed to fetch media assets:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    fetchMediaAssets();
  };

  const handleAssetClick = (asset: MediaAsset) => {
    if (multiSelect) {
      if (selectedAssetsMulti.some((a) => a.id === asset.id)) {
        setSelectedAssetsMulti(selectedAssetsMulti.filter((a) => a.id !== asset.id));
      } else {
        setSelectedAssetsMulti([...selectedAssetsMulti, asset]);
      }
    } else {
      setSelectedAsset(asset);
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
          setErrorMessage('Please select a file to upload');
          setLoading(false);
          return;
        }

        const formData = new FormData();
        formData.append('file', uploadFile);
        formData.append('caption', caption);
        formData.append('credit', credit);
        formData.append('altText', altText);

        const res = await fetch('/api/media/file-upload', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
          },
          body: formData,
        });

        const data = await res.json();
        if (res.ok) {
          setSuccessMessage('File binary verified and uploaded!');
          fetchMediaAssets();
          setSelectedAsset(data);
          setActiveTab('library');
        } else {
          setErrorMessage(data.error || 'Upload failed header verification');
        }
      } else {
        if (!uploadUrl) return;
        if (!uploadUrlMimeType) {
          setErrorMessage('Declare the real content type of the external asset (the server no longer invents image/jpeg).');
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
            filename: filename || undefined,
            caption,
            credit,
            altText,
            assetType: 'IMAGE',
          }),
        });

        const data = await res.json();
        if (res.ok) {
          setSuccessMessage('Media asset created');
          fetchMediaAssets();
          setSelectedAsset(data);
          setActiveTab('library');
        } else {
          setErrorMessage(data.error || 'Failed to upload media asset');
        }
      }
    } catch (err: any) {
      setErrorMessage(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmSelection = () => {
    if (multiSelect && onSelectMultipleMedia) {
      if (selectedAssetsMulti.length === 0) return;
      onSelectMultipleMedia(
        selectedAssetsMulti.map((a) => ({
          id: a.id,
          url: a.originalUrl,
          caption: a.caption,
          credit: a.credit,
          altText: a.altText,
        }))
      );
      onClose();
    } else if (selectedAsset) {
      onSelectMedia({
        id: selectedAsset.id,
        url: selectedAsset.originalUrl,
        caption: selectedAsset.caption,
        credit: selectedAsset.credit,
        altText: selectedAsset.altText,
      });
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/60 backdrop-blur-xs">
      <div className="bg-white rounded-2xl shadow-2xl border border-stone-200 w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-stone-200 bg-stone-50">
          <div className="flex items-center space-x-2">
            <ImageIcon className="w-5 h-5 text-red-700" />
            <h3 className="font-serif font-bold text-lg text-stone-900">
              Newsroom Media Asset Selector
            </h3>
          </div>
          <button
            onClick={onClose}
            className="text-stone-400 hover:text-stone-700 transition-colors p-1 rounded-lg"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs & Search Bar */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 px-6 py-3 border-b border-stone-100 bg-white">
          <div className="flex space-x-2 text-xs font-semibold">
            <button
              onClick={() => setActiveTab('library')}
              className={`px-4 py-2 rounded-xl transition-colors ${
                activeTab === 'library'
                  ? 'bg-stone-900 text-white shadow-2xs'
                  : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
              }`}
            >
              Browse Library ({assets.length})
            </button>
            <button
              onClick={() => setActiveTab('upload')}
              className={`px-4 py-2 rounded-xl transition-colors flex items-center space-x-1.5 ${
                activeTab === 'upload'
                  ? 'bg-stone-900 text-white shadow-2xs'
                  : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
              }`}
            >
              <Upload className="w-3.5 h-3.5" />
              <span>Add New Asset</span>
            </button>
          </div>

          {activeTab === 'library' && (
            <form onSubmit={handleSearchSubmit} className="relative w-full sm:w-64">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search credits, captions..."
                className="w-full bg-stone-50 border border-stone-300 rounded-xl pl-9 pr-4 py-1.5 text-xs text-stone-900 focus:outline-none focus:border-stone-800"
              />
              <Search className="w-3.5 h-3.5 text-stone-400 absolute left-3 top-2.5" />
            </form>
          )}
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6">
          {errorMessage && (
            <div className="mb-4 bg-red-50 border border-red-200 text-red-700 px-4 py-2.5 rounded-xl text-xs flex items-center justify-between">
              <span>{errorMessage}</span>
              <button onClick={() => setErrorMessage('')}>✕</button>
            </div>
          )}
          {successMessage && (
            <div className="mb-4 bg-emerald-50 border border-emerald-200 text-emerald-800 px-4 py-2.5 rounded-xl text-xs flex items-center justify-between">
              <span>{successMessage}</span>
              <button onClick={() => setSuccessMessage('')}>✕</button>
            </div>
          )}

          {activeTab === 'library' ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              {assets.map((asset) => {
                const isSelected = multiSelect
                  ? selectedAssetsMulti.some((a) => a.id === asset.id)
                  : selectedAsset?.id === asset.id;

                return (
                  <div
                    key={asset.id}
                    onClick={() => handleAssetClick(asset)}
                    className={`group relative rounded-xl border-2 overflow-hidden cursor-pointer transition-all ${
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
                      {isSelected && (
                        <div className="absolute top-2 right-2 bg-red-700 text-white rounded-full p-1 shadow-xs">
                          <Check className="w-3.5 h-3.5" />
                        </div>
                      )}
                    </div>
                    <div className="p-2.5 bg-white text-[11px] space-y-0.5">
                      <p className="font-semibold text-stone-900 truncate">{asset.filename}</p>
                      <p className="text-stone-500 truncate text-[10px]">
                        {asset.credit || 'No credit attribution'}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <form onSubmit={handleUploadSubmit} className="space-y-5 max-w-xl mx-auto">
              <div className="flex space-x-2 border-b border-stone-100 pb-2 text-xs font-semibold">
                <button
                  type="button"
                  onClick={() => setUploadMode('file')}
                  className={`px-3 py-1.5 rounded-lg ${
                    uploadMode === 'file' ? 'bg-stone-900 text-white' : 'text-stone-600 bg-stone-100'
                  }`}
                >
                  Binary File Upload
                </button>
                <button
                  type="button"
                  onClick={() => setUploadMode('url')}
                  className={`px-3 py-1.5 rounded-lg ${
                    uploadMode === 'url' ? 'bg-stone-900 text-white' : 'text-stone-600 bg-stone-100'
                  }`}
                >
                  External URL
                </button>
              </div>

              {uploadMode === 'file' ? (
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-stone-600 mb-1">
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
                  <label className="block text-xs font-semibold uppercase tracking-wider text-stone-600 mb-1">
                    Image URL *
                  </label>
                  <input
                    type="url"
                    required
                    value={uploadUrl}
                    onChange={(e) => setUploadUrl(e.target.value)}
                    placeholder="https://…/real-image-location.jpg"
                    className="w-full bg-stone-50 border border-stone-300 rounded-xl px-4 py-2.5 text-xs text-stone-900 focus:outline-none focus:border-stone-800"
                  />
                  <label className="block text-xs font-semibold uppercase tracking-wider text-stone-600 mt-4 mb-1">
                    Content type *
                  </label>
                  <select
                    required
                    value={uploadUrlMimeType}
                    onChange={(e) => setUploadUrlMimeType(e.target.value)}
                    className="w-full bg-stone-50 border border-stone-300 rounded-xl px-4 py-2.5 text-xs text-stone-900 focus:outline-none focus:border-stone-800"
                  >
                    <option value="">— declare the real content type —</option>
                    <option value="image/jpeg">image/jpeg</option>
                    <option value="image/png">image/png</option>
                    <option value="image/webp">image/webp</option>
                    <option value="image/avif">image/avif</option>
                    <option value="image/gif">image/gif</option>
                    <option value="image/svg+xml">image/svg+xml</option>
                  </select>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-stone-600 mb-1">
                    Photographer / Credit
                  </label>
                  <input
                    type="text"
                    value={credit}
                    onChange={(e) => setCredit(e.target.value)}
                    placeholder="Global Chronicle Photo Wire"
                    className="w-full bg-stone-50 border border-stone-300 rounded-xl px-4 py-2 text-xs text-stone-900"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-stone-600 mb-1">
                    Alt Text
                  </label>
                  <input
                    type="text"
                    value={altText}
                    onChange={(e) => setAltText(e.target.value)}
                    placeholder="Accessible description"
                    className="w-full bg-stone-50 border border-stone-300 rounded-xl px-4 py-2 text-xs text-stone-900"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-stone-600 mb-1">
                  Caption
                </label>
                <textarea
                  rows={2}
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                  placeholder="Dispatch caption..."
                  className="w-full bg-stone-50 border border-stone-300 rounded-xl p-3 text-xs text-stone-900"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-stone-900 hover:bg-stone-800 text-white font-semibold py-3 rounded-xl text-xs transition-colors shadow-xs"
              >
                {loading ? 'Uploading...' : 'Upload & Add to Library'}
              </button>
            </form>
          )}
        </div>

        {/* Modal Footer */}
        {activeTab === 'library' && (
          <div className="flex items-center justify-between px-6 py-4 border-t border-stone-200 bg-stone-50">
            <div className="text-xs text-stone-500">
              {multiSelect ? (
                <span>
                  Selected: <strong className="text-stone-900">{selectedAssetsMulti.length} assets</strong>
                </span>
              ) : selectedAsset ? (
                <span>
                  Selected: <strong className="text-stone-900">{selectedAsset.filename}</strong>
                </span>
              ) : (
                'Click an asset to select'
              )}
            </div>

            <div className="flex items-center space-x-3">
              <button
                onClick={onClose}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-stone-600 hover:bg-stone-200 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmSelection}
                disabled={multiSelect ? selectedAssetsMulti.length === 0 : !selectedAsset}
                className="bg-red-700 hover:bg-red-800 disabled:opacity-50 text-white px-5 py-2 rounded-xl text-xs font-semibold transition-colors shadow-xs"
              >
                {multiSelect
                  ? `Insert ${selectedAssetsMulti.length} Asset(s)`
                  : 'Use Selected Asset'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
