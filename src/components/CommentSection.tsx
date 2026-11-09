/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { MessageSquare, Send, CheckCircle2, Clock, ShieldCheck } from 'lucide-react';

interface Comment {
  id: string;
  authorName: string;
  content: string;
  createdAt: string;
}

interface CommentSectionProps {
  articleId: string;
}

export const CommentSection: React.FC<CommentSectionProps> = ({ articleId }) => {
  const [comments, setComments] = useState<Comment[]>([]);
  const [authorName, setAuthorName] = useState('');
  const [authorEmail, setAuthorEmail] = useState('');
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    fetchComments();
  }, [articleId]);

  const fetchComments = async () => {
    try {
      const res = await fetch(`/api/comments?articleId=${articleId}&status=APPROVED`);
      const data = await res.json();
      if (Array.isArray(data)) {
        setComments(data);
      }
    } catch (err) {
      console.error('Error fetching comments:', err);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!authorName || !authorEmail || !content) return;

    setLoading(true);
    setErrorMessage('');

    try {
      const res = await fetch('/api/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          articleId,
          authorName,
          authorEmail,
          content,
        }),
      });

      const data = await res.json();
      if (res.ok) {
        setSubmitted(true);
        setContent('');
      } else {
        setErrorMessage(data.error || 'Failed to submit comment');
      }
    } catch (err: any) {
      setErrorMessage(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-stone-50 border border-stone-200 rounded-2xl p-6 sm:p-8 shadow-2xs space-y-8 my-8 font-sans">
      <div className="flex items-center justify-between border-b border-stone-200 pb-4">
        <div className="flex items-center space-x-2">
          <MessageSquare className="w-5 h-5 text-red-700" />
          <h3 className="font-serif font-bold text-xl text-stone-900">
            Reader Discussion ({comments.length})
          </h3>
        </div>

        <div className="flex items-center space-x-1.5 text-xs text-stone-500">
          <ShieldCheck className="w-4 h-4 text-emerald-600" />
          <span>Moderated Newsroom Community</span>
        </div>
      </div>

      {/* Comment Form */}
      <form onSubmit={handleSubmit} className="bg-white border border-stone-200 rounded-2xl p-6 space-y-4 shadow-2xs">
        <h4 className="font-serif font-bold text-sm text-stone-900">
          Join the Conversation
        </h4>

        {submitted && (
          <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 p-4 rounded-xl text-xs flex items-center space-x-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>
              Your comment has been submitted to the newsroom moderation queue. Once verified by copy editors, it will appear publicly.
            </span>
          </div>
        )}

        {errorMessage && (
          <div className="bg-red-50 border border-red-200 text-red-700 p-3 rounded-xl text-xs">
            {errorMessage}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-stone-700 mb-1">Your Full Name *</label>
            <input
              type="text"
              required
              value={authorName}
              onChange={(e) => setAuthorName(e.target.value)}
              placeholder="e.g. Elena Rostova"
              className="w-full bg-stone-50 border border-stone-300 rounded-xl px-4 py-2.5 text-xs text-stone-900 focus:outline-none focus:border-stone-800"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-stone-700 mb-1">Email Address (Private) *</label>
            <input
              type="email"
              required
              value={authorEmail}
              onChange={(e) => setAuthorEmail(e.target.value)}
              placeholder="elena@example.com"
              className="w-full bg-stone-50 border border-stone-300 rounded-xl px-4 py-2.5 text-xs text-stone-900 focus:outline-none focus:border-stone-800"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-stone-700 mb-1">Comment Body *</label>
          <textarea
            rows={3}
            required
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Share your perspective on this report..."
            className="w-full bg-stone-50 border border-stone-300 rounded-xl p-3 text-xs text-stone-900 focus:outline-none focus:border-stone-800 leading-relaxed"
          />
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={loading}
            className="bg-stone-900 hover:bg-stone-800 text-white font-semibold px-5 py-2.5 rounded-xl text-xs flex items-center space-x-2 transition-colors shadow-xs"
          >
            <Send className="w-3.5 h-3.5" />
            <span>Submit Comment</span>
          </button>
        </div>
      </form>

      {/* Approved Comments Feed */}
      <div className="space-y-4">
        {comments.map((comment) => (
          <div key={comment.id} className="bg-white border border-stone-200 rounded-2xl p-5 shadow-2xs space-y-2">
            <div className="flex items-center justify-between border-b border-stone-100 pb-2">
              <span className="font-bold text-xs text-stone-900">{comment.authorName}</span>
              <span className="text-[10px] text-stone-400 font-mono">
                {new Date(comment.createdAt).toLocaleDateString()}
              </span>
            </div>
            <p className="text-stone-800 text-xs leading-relaxed font-sans">
              {comment.content}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
};
