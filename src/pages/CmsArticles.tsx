/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { Edit, Trash2, PlusCircle, Eye, Clock, CheckCircle, AlertTriangle, ArrowRight, MessageSquare, Shield } from 'lucide-react';

interface CmsArticlesProps {
  token: string;
  onEditArticle: (articleId: string) => void;
  onNewArticle: () => void;
}

export const CmsArticles: React.FC<CmsArticlesProps> = ({ token, onEditArticle, onNewArticle }) => {
  const [articles, setArticles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [transitionArticleId, setTransitionArticleId] = useState<string | null>(null);
  const [transitionTargetState, setTransitionTargetState] = useState<string | null>(null);
  const [transitionNote, setTransitionNote] = useState('');
  const [feedbackMessage, setFeedbackMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  const fetchArticles = () => {
    setLoading(true);
    const url = statusFilter ? `/api/articles?status=${statusFilter}` : '/api/articles';
    fetch(url)
      .then((res) => res.json())
      .then((data) => {
        setArticles(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  useEffect(() => {
    fetchArticles();
  }, [statusFilter]);

  const handleTransitionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!transitionArticleId || !transitionTargetState) return;

    try {
      const res = await fetch(`/api/articles/${transitionArticleId}/transition`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          targetState: transitionTargetState,
          note: transitionNote,
        }),
      });

      const data = await res.json();
      if (res.ok) {
        setFeedbackMessage(`Dispatch successfully moved to ${transitionTargetState}.`);
        setTransitionArticleId(null);
        setTransitionTargetState(null);
        setTransitionNote('');
        fetchArticles();
      } else {
        setErrorMessage(data.error || 'Failed to transition article state.');
      }
    } catch (err: any) {
      setErrorMessage(err.message);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/articles/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setDeleteConfirmId(null);
        setFeedbackMessage('Article deleted successfully.');
        setTimeout(() => setFeedbackMessage(''), 3000);
        fetchArticles();
      } else {
        const data = await res.json();
        setErrorMessage(data.error || 'Permission denied or error deleting article.');
      }
    } catch (err) {
      setErrorMessage('Error connecting to server.');
    }
  };

  return (
    <div className="space-y-6 pb-16">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center bg-white p-6 rounded-2xl border border-stone-200 gap-4 shadow-2xs">
        <div>
          <h2 className="font-serif font-bold text-2xl text-stone-900">Editorial Dispatches & Queues</h2>
          <p className="text-stone-500 text-xs mt-1">Review, approve, schedule, and publish newsroom submissions.</p>
        </div>
        <button
          onClick={onNewArticle}
          className="bg-red-700 hover:bg-red-800 text-white font-semibold px-4 py-2.5 rounded-xl text-xs transition-colors flex items-center space-x-2 shadow-xs"
        >
          <PlusCircle className="w-4 h-4" />
          <span>New Dispatch</span>
        </button>
      </div>

      {feedbackMessage && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-medium px-4 py-3 rounded-xl shadow-xs flex items-center justify-between">
          <span>{feedbackMessage}</span>
          <button onClick={() => setFeedbackMessage('')} className="text-emerald-600 hover:text-emerald-900">✕</button>
        </div>
      )}

      {errorMessage && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-xs font-medium px-4 py-3 rounded-xl shadow-xs flex items-center justify-between">
          <span>{errorMessage}</span>
          <button onClick={() => setErrorMessage('')} className="text-red-500 hover:text-red-800">✕</button>
        </div>
      )}

      {/* Filter Tabs */}
      <div className="flex flex-wrap gap-2 border-b border-stone-200 pb-3">
        {[
          { label: 'All Dispatches', value: '' },
          { label: 'Review Queue', value: 'IN_REVIEW' },
          { label: 'Changes Requested', value: 'CHANGES_REQUESTED' },
          { label: 'Scheduled', value: 'SCHEDULED' },
          { label: 'Published', value: 'PUBLISHED' },
          { label: 'Archived', value: 'ARCHIVED' },
        ].map((tab) => (
          <button
            key={tab.value}
            onClick={() => setStatusFilter(tab.value)}
            className={`px-4 py-2 rounded-xl text-xs font-semibold uppercase tracking-wider transition-colors ${
              statusFilter === tab.value ? 'bg-stone-900 text-white' : 'bg-white border border-stone-200 text-stone-700 hover:bg-stone-100'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Main Table */}
      {loading ? (
        <div className="py-20 text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-stone-900 mx-auto"></div>
        </div>
      ) : (
        <div className="bg-white border border-stone-200 rounded-2xl overflow-hidden shadow-2xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-stone-50 border-b border-stone-200 text-stone-600 text-[11px] uppercase font-bold tracking-wider">
                  <th className="p-4">Title</th>
                  <th className="p-4">Bureau</th>
                  <th className="p-4">Author</th>
                  <th className="p-4">Status</th>
                  <th className="p-4">Reads</th>
                  <th className="p-4 text-right">Editorial Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100 text-xs">
                {articles.length > 0 ? (
                  articles.map((art) => (
                    <tr key={art.id} className="hover:bg-stone-50/60 transition-colors">
                      <td className="p-4 font-serif font-bold text-stone-900 max-w-xs md:max-w-md truncate">
                        {art.title}
                      </td>
                      <td className="p-4">
                        <span className="font-semibold text-stone-700 bg-stone-100 px-2.5 py-1 rounded-md text-[11px]">
                          {art.category?.name || 'General'}
                        </span>
                      </td>
                      <td className="p-4 text-stone-600">{art.author?.name || 'Staff Writer'}</td>
                      <td className="p-4">
                        <span
                          className={`font-bold uppercase text-[9px] tracking-wider px-2.5 py-1 rounded-full ${
                            art.status === 'PUBLISHED'
                              ? 'bg-emerald-100 text-emerald-800'
                              : art.status === 'IN_REVIEW'
                              ? 'bg-amber-100 text-amber-800'
                              : art.status === 'CHANGES_REQUESTED'
                              ? 'bg-red-100 text-red-800'
                              : art.status === 'SCHEDULED'
                              ? 'bg-blue-100 text-blue-800'
                              : 'bg-stone-100 text-stone-700'
                          }`}
                        >
                          {art.status}
                        </span>
                      </td>
                      <td className="p-4 text-stone-500 font-mono text-[11px]">{art.views || 0}</td>
                      <td className="p-4 text-right">
                        <div className="flex items-center justify-end space-x-2">
                          {/* Workflow Transition Buttons */}
                          {art.status === 'DRAFT' && (
                            <button
                              onClick={() => {
                                setTransitionArticleId(art.id);
                                setTransitionTargetState('IN_REVIEW');
                              }}
                              className="text-[10px] font-bold bg-amber-50 hover:bg-amber-100 text-amber-800 px-2 py-1 rounded-md border border-amber-200"
                              title="Submit for Editorial Review"
                            >
                              Submit Review
                            </button>
                          )}

                          {art.status === 'IN_REVIEW' && (
                            <>
                              <button
                                onClick={() => {
                                  setTransitionArticleId(art.id);
                                  setTransitionTargetState('APPROVED');
                                }}
                                className="text-[10px] font-bold bg-emerald-50 hover:bg-emerald-100 text-emerald-800 px-2 py-1 rounded-md border border-emerald-200"
                              >
                                Approve
                              </button>
                              <button
                                onClick={() => {
                                  setTransitionArticleId(art.id);
                                  setTransitionTargetState('CHANGES_REQUESTED');
                                }}
                                className="text-[10px] font-bold bg-red-50 hover:bg-red-100 text-red-800 px-2 py-1 rounded-md border border-red-200"
                              >
                                Request Changes
                              </button>
                            </>
                          )}

                          {art.status === 'APPROVED' && (
                            <button
                              onClick={() => {
                                setTransitionArticleId(art.id);
                                setTransitionTargetState('PUBLISHED');
                              }}
                              className="text-[10px] font-bold bg-red-700 hover:bg-red-800 text-white px-2 py-1 rounded-md"
                            >
                              Publish
                            </button>
                          )}

                          {/* Standard Actions */}
                          <button
                            onClick={() => onEditArticle(art.id)}
                            className="p-1.5 hover:bg-stone-100 rounded-lg text-stone-600 transition-colors"
                            title="Edit Article"
                          >
                            <Edit className="w-4 h-4" />
                          </button>

                          <button
                            onClick={() => setDeleteConfirmId(art.id)}
                            className="p-1.5 hover:bg-red-50 rounded-lg text-red-600 transition-colors"
                            title="Delete Article"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-xs text-stone-400 italic">
                      No article dispatches match the selected queue filter.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* State Transition Modal */}
      {transitionArticleId && transitionTargetState && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full space-y-4 shadow-xl border border-stone-200">
            <h3 className="font-serif font-bold text-lg text-stone-900">
              Confirm Workflow Transition
            </h3>
            <p className="text-xs text-stone-600">
              Moving dispatch state to <span className="font-bold text-red-700">{transitionTargetState}</span>.
              {(transitionTargetState === 'CHANGES_REQUESTED' || transitionTargetState === 'UNPUBLISHED') &&
                ' Editorial policy requires mandatory reviewer feedback.'}
            </p>

            <textarea
              rows={3}
              value={transitionNote}
              onChange={(e) => setTransitionNote(e.target.value)}
              placeholder="Enter editorial transition note or feedback for author..."
              className="w-full bg-stone-50 border border-stone-300 rounded-xl p-3 text-xs text-stone-900 focus:outline-none focus:border-stone-800"
            />

            <div className="flex justify-end space-x-2 pt-2">
              <button
                onClick={() => {
                  setTransitionArticleId(null);
                  setTransitionTargetState(null);
                  setTransitionNote('');
                }}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-stone-600 hover:bg-stone-100"
              >
                Cancel
              </button>
              <button
                onClick={handleTransitionSubmit}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-stone-900 hover:bg-stone-800 text-white shadow-xs"
              >
                Confirm Transition
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirmId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full space-y-4 shadow-xl border border-stone-200 text-center">
            <div className="w-12 h-12 bg-red-100 text-red-700 rounded-full flex items-center justify-center mx-auto">
              <Trash2 className="w-6 h-6" />
            </div>
            <h3 className="font-serif font-bold text-base text-stone-900">Delete Dispatch?</h3>
            <p className="text-xs text-stone-600 leading-snug">
              Are you sure you want to delete this article? This action will remove the record from editorial queues.
            </p>
            <div className="flex justify-center space-x-3 pt-2">
              <button
                onClick={() => setDeleteConfirmId(null)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-stone-600 bg-stone-100 hover:bg-stone-200"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(deleteConfirmId)}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-red-700 hover:bg-red-800 text-white"
              >
                Yes, Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
