/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { Radio, RefreshCw, Clock, Star, Bell } from 'lucide-react';

interface LiveBlogUpdate {
  id: string;
  headline: string;
  body: string;
  isKeyEvent: boolean;
  createdAt: string;
}

interface LiveBlogStreamProps {
  articleId: string;
}

export const LiveBlogStream: React.FC<LiveBlogStreamProps> = ({ articleId }) => {
  const [updates, setUpdates] = useState<LiveBlogUpdate[]>([]);
  const [loading, setLoading] = useState(false);
  const [filterKeyEvents, setFilterKeyEvents] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState<string>('');

  useEffect(() => {
    fetchUpdates();
    const interval = setInterval(fetchUpdates, 15000); // 15-second polling sweep
    return () => clearInterval(interval);
  }, [articleId]);

  const fetchUpdates = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/liveblogs/${articleId}`);
      const data = await res.json();
      if (Array.isArray(data)) {
        setUpdates(data);
        setLastRefreshed(new Date().toLocaleTimeString());
      }
    } catch (err) {
      console.error('Error fetching live blog updates:', err);
    } finally {
      setLoading(false);
    }
  };

  const filteredUpdates = filterKeyEvents
    ? updates.filter((u) => u.isKeyEvent)
    : updates;

  if (updates.length === 0) return null;

  return (
    <div className="bg-stone-50 border border-stone-200 rounded-2xl p-6 shadow-2xs space-y-6 my-8">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-stone-200 pb-4">
        <div className="flex items-center space-x-3">
          <div className="relative">
            <span className="flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-red-600"></span>
            </span>
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h3 className="font-serif font-bold text-lg text-stone-900">
                Live Coverage Stream
              </h3>
              <span className="bg-red-700 text-white font-bold text-[10px] px-2 py-0.5 rounded-full uppercase tracking-wider">
                Developing
              </span>
            </div>
            <p className="text-xs text-stone-500 font-sans">
              Real-time minute-by-minute updates from on-ground correspondents
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-3">
          <button
            onClick={() => setFilterKeyEvents(!filterKeyEvents)}
            className={`text-xs font-semibold px-3 py-1.5 rounded-xl border transition-colors flex items-center space-x-1.5 ${
              filterKeyEvents
                ? 'bg-amber-100 text-amber-900 border-amber-300 font-bold'
                : 'bg-white text-stone-700 border-stone-200 hover:bg-stone-100'
            }`}
          >
            <Star className={`w-3.5 h-3.5 ${filterKeyEvents ? 'fill-current text-amber-600' : ''}`} />
            <span>{filterKeyEvents ? 'Key Events Only' : 'Show All Updates'}</span>
          </button>

          <button
            onClick={fetchUpdates}
            className="p-2 bg-white hover:bg-stone-100 border border-stone-200 text-stone-600 rounded-xl transition-colors"
            title="Refresh stream"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Timeline Stream */}
      <div className="relative border-l-2 border-stone-300 ml-3 space-y-6 pl-6 pt-1">
        {filteredUpdates.map((update) => (
          <div key={update.id} className="relative group">
            {/* Timeline node */}
            <div
              className={`absolute -left-[31px] top-1.5 w-4 h-4 rounded-full border-2 border-white shadow-xs ${
                update.isKeyEvent ? 'bg-amber-500 ring-4 ring-amber-100' : 'bg-stone-800'
              }`}
            />

            <div className="bg-white border border-stone-200 rounded-xl p-4 shadow-2xs space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2 text-stone-500 text-xs font-mono">
                  <Clock className="w-3.5 h-3.5 text-stone-400" />
                  <span>{new Date(update.createdAt).toLocaleTimeString()}</span>
                </div>

                {update.isKeyEvent && (
                  <span className="bg-amber-50 text-amber-800 border border-amber-200 text-[10px] font-bold px-2 py-0.5 rounded-md flex items-center space-x-1">
                    <Star className="w-3 h-3 fill-amber-500 text-amber-500" />
                    <span>KEY EVENT</span>
                  </span>
                )}
              </div>

              <h4 className="font-serif font-bold text-stone-900 text-base leading-snug">
                {update.headline}
              </h4>

              <p className="text-stone-700 text-xs leading-relaxed font-sans whitespace-pre-wrap">
                {update.body}
              </p>
            </div>
          </div>
        ))}
      </div>

      <div className="text-center text-[11px] text-stone-400 pt-2 border-t border-stone-200">
        Auto-sync active • Last updated at {lastRefreshed || 'just now'}
      </div>
    </div>
  );
};
