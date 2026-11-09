/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { ThumbsUp, Flame, BookmarkCheck, Scale } from 'lucide-react';

interface ReactionMeterProps {
  articleId: string;
}

export const ReactionMeter: React.FC<ReactionMeterProps> = ({ articleId }) => {
  const [counts, setCounts] = useState<{ [key: string]: number }>({
    INSIGHTFUL: 0,
    URGENT: 0,
    ESSENTIAL: 0,
    BALANCED: 0,
  });
  const [userReaction, setUserReaction] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetchReactions();
  }, [articleId]);

  const fetchReactions = async () => {
    try {
      const res = await fetch(`/api/reactions/${articleId}`);
      const data = await res.json();
      if (data && typeof data === 'object') {
        setCounts(data);
      }
    } catch (err) {
      console.error('Error fetching reaction counts:', err);
    }
  };

  const handleVote = async (type: 'INSIGHTFUL' | 'URGENT' | 'ESSENTIAL' | 'BALANCED') => {
    if (submitting) return;
    setSubmitting(true);
    setUserReaction(type);

    try {
      const res = await fetch(`/api/reactions/${articleId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type }),
      });

      const data = await res.json();
      if (res.ok && data.counts) {
        setCounts(data.counts);
      }
    } catch (err) {
      console.error('Error submitting reaction:', err);
    } finally {
      setSubmitting(false);
    }
  };

  const reactionButtons = [
    { type: 'INSIGHTFUL', label: 'Insightful', icon: ThumbsUp, color: 'text-amber-700 bg-amber-50 hover:bg-amber-100 border-amber-200' },
    { type: 'URGENT', label: 'Urgent', icon: Flame, color: 'text-red-700 bg-red-50 hover:bg-red-100 border-red-200' },
    { type: 'ESSENTIAL', label: 'Essential', icon: BookmarkCheck, color: 'text-blue-700 bg-blue-50 hover:bg-blue-100 border-blue-200' },
    { type: 'BALANCED', label: 'Balanced', icon: Scale, color: 'text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border-emerald-200' },
  ];

  const totalVotes = Object.values(counts).reduce((acc, curr) => acc + curr, 0);

  return (
    <div className="bg-white border border-stone-200 rounded-2xl p-6 shadow-2xs space-y-4 my-8">
      <div className="flex items-center justify-between border-b border-stone-100 pb-3">
        <div>
          <h4 className="font-serif font-bold text-base text-stone-900">
            Reader Reaction Meter
          </h4>
          <p className="text-xs text-stone-500 font-sans">
            How would you evaluate this dispatch? Express your perspective.
          </p>
        </div>
        <span className="text-xs font-semibold text-stone-500 bg-stone-100 px-3 py-1 rounded-full">
          {totalVotes} Reader Ratings
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {reactionButtons.map((item) => {
          const Icon = item.icon;
          const voteCount = counts[item.type] || 0;
          const isSelected = userReaction === item.type;
          const percent = totalVotes > 0 ? Math.round((voteCount / totalVotes) * 100) : 0;

          return (
            <button
              key={item.type}
              onClick={() => handleVote(item.type as any)}
              disabled={submitting}
              className={`p-3 rounded-xl border text-left transition-all relative overflow-hidden flex flex-col justify-between h-24 ${
                isSelected ? 'ring-2 ring-stone-900 shadow-sm' : ''
              } ${item.color}`}
            >
              <div className="flex items-center justify-between">
                <Icon className="w-4 h-4" />
                <span className="text-xs font-bold font-mono">{percent}%</span>
              </div>

              <div>
                <span className="block font-bold text-xs">{item.label}</span>
                <span className="text-[10px] font-medium opacity-80">{voteCount} votes</span>
              </div>

              {/* Progress bar fill background */}
              <div
                style={{ width: `${percent}%` }}
                className="absolute bottom-0 left-0 h-1 bg-current opacity-30 transition-all duration-500"
              />
            </button>
          );
        })}
      </div>
    </div>
  );
};
