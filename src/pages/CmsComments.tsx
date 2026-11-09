/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { MessageSquare, Check, X, ShieldAlert, ArrowLeft, Filter } from 'lucide-react';

interface CmsCommentsProps {
  token: string;
  onBack?: () => void;
}

export const CmsComments: React.FC<CmsCommentsProps> = ({ token, onBack }) => {
  const [comments, setComments] = useState<any[]>([]);
  const [statusFilter, setStatusFilter] = useState<'PENDING' | 'APPROVED' | 'REJECTED' | 'SPAM'>('PENDING');
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  useEffect(() => {
    fetchComments();
  }, [statusFilter]);

  const fetchComments = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/comments?status=${statusFilter}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (Array.isArray(data)) {
        setComments(data);
      }
    } catch (err: any) {
      setErrorMessage('Failed to fetch comments moderation queue');
    } finally {
      setLoading(false);
    }
  };

  const handleModerate = async (commentId: string, status: 'APPROVED' | 'REJECTED' | 'SPAM') => {
    setLoading(true);
    setErrorMessage('');
    setSuccessMessage('');

    try {
      const res = await fetch(`/api/comments/${commentId}/moderate`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ status }),
      });

      const data = await res.json();
      if (res.ok) {
        setSuccessMessage(`Comment status updated to ${status}`);
        fetchComments();
      } else {
        setErrorMessage(data.error || 'Failed to moderate comment');
      }
    } catch (err: any) {
      setErrorMessage(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6 pb-20">
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
            Reader Comments Moderation Queue
          </h2>
        </div>

        {/* Filter Tabs */}
        <div className="flex space-x-2 text-xs font-semibold bg-stone-100 p-1 rounded-xl">
          {(['PENDING', 'APPROVED', 'REJECTED', 'SPAM'] as const).map((st) => (
            <button
              key={st}
              onClick={() => setStatusFilter(st)}
              className={`px-3 py-1.5 rounded-lg transition-colors ${
                statusFilter === st
                  ? 'bg-white text-stone-900 shadow-xs font-bold'
                  : 'text-stone-600 hover:text-stone-900'
              }`}
            >
              {st}
            </button>
          ))}
        </div>
      </div>

      {/* Notifications */}
      {errorMessage && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-xs font-medium flex items-center justify-between">
          <span>{errorMessage}</span>
          <button onClick={() => setErrorMessage('')}>✕</button>
        </div>
      )}
      {successMessage && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 px-4 py-3 rounded-xl text-xs font-medium flex items-center justify-between">
          <span>{successMessage}</span>
          <button onClick={() => setSuccessMessage('')}>✕</button>
        </div>
      )}

      {/* Comments List */}
      <div className="space-y-4">
        {comments.length > 0 ? (
          comments.map((comment) => (
            <div
              key={comment.id}
              className="bg-white border border-stone-200 rounded-2xl p-6 shadow-2xs space-y-3"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-stone-100 pb-3">
                <div>
                  <span className="font-bold text-sm text-stone-900">{comment.authorName}</span>
                  <span className="text-xs text-stone-400 ml-2">({comment.authorEmail})</span>
                  {comment.article?.title && (
                    <p className="text-xs font-serif text-stone-600 italic mt-0.5">
                      Dispatch: {comment.article.title}
                    </p>
                  )}
                </div>

                <span className="text-[10px] text-stone-400 font-mono">
                  {new Date(comment.createdAt).toLocaleString()}
                </span>
              </div>

              <p className="text-stone-800 text-xs leading-relaxed font-sans whitespace-pre-wrap">
                {comment.content}
              </p>

              {/* Action Buttons */}
              <div className="flex items-center justify-end space-x-2 pt-2 border-t border-stone-100">
                {statusFilter !== 'APPROVED' && (
                  <button
                    onClick={() => handleModerate(comment.id, 'APPROVED')}
                    className="bg-emerald-700 hover:bg-emerald-800 text-white font-semibold px-3 py-1.5 rounded-lg text-xs flex items-center space-x-1.5 transition-colors shadow-xs"
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span>Approve</span>
                  </button>
                )}

                {statusFilter !== 'REJECTED' && (
                  <button
                    onClick={() => handleModerate(comment.id, 'REJECTED')}
                    className="bg-stone-200 hover:bg-stone-300 text-stone-800 font-semibold px-3 py-1.5 rounded-lg text-xs flex items-center space-x-1.5 transition-colors"
                  >
                    <X className="w-3.5 h-3.5" />
                    <span>Reject</span>
                  </button>
                )}

                {statusFilter !== 'SPAM' && (
                  <button
                    onClick={() => handleModerate(comment.id, 'SPAM')}
                    className="bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 font-semibold px-3 py-1.5 rounded-lg text-xs flex items-center space-x-1.5 transition-colors"
                  >
                    <ShieldAlert className="w-3.5 h-3.5" />
                    <span>Flag Spam</span>
                  </button>
                )}
              </div>
            </div>
          ))
        ) : (
          <div className="bg-white border border-stone-200 rounded-2xl p-12 text-center text-xs text-stone-400 italic space-y-2">
            <MessageSquare className="w-8 h-8 text-stone-300 mx-auto" />
            <p>No comments found in the {statusFilter.toLowerCase()} moderation queue.</p>
          </div>
        )}
      </div>
    </div>
  );
};
