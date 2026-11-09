/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Bell, Clock, AlertTriangle, X } from 'lucide-react';

interface NotificationItem {
  id: string;
  title: string;
  description: string;
  type: 'REVIEW' | 'COMMENT' | 'SYSTEM';
  timestamp: string;
  targetView?: string;
}

interface AdminNotificationsProps {
  token: string;
  onNavigate: (view: string) => void;
}

/** Relative time as displayed; falls back to a short date for old entries. */
function displayTimestamp(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const diffMs = Date.now() - t;
  if (diffMs < 90_000) return 'just now';
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

/**
 * Phase 10: notifications are DERIVED FROM REAL EVENTS via
 * GET /api/admin/notifications (review backlog, pending comments, overdue
 * scheduled releases, scheduler daemon errors). No fabricated entries.
 */
export const AdminNotifications: React.FC<AdminNotificationsProps> = ({ token, onNavigate }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/notifications', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`Server returned ${res.status}.`);
      const items = await res.json();
      setNotifications(Array.isArray(items) ? items : []);
    } catch {
      setError('Notifications are unavailable right now.');
      setNotifications([]);
    } finally {
      setLoading(false);
    }
  }, [token]);

  // Load once when the dropdown is opened; refresh on each open
  useEffect(() => {
    if (isOpen) void load();
  }, [isOpen, load]);

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="p-2 rounded-lg text-stone-600 hover:text-stone-900 hover:bg-stone-100 relative transition-colors"
        title="Editorial Notifications"
      >
        <Bell className="w-5 h-5" />
        {!loading && notifications.length > 0 && (
          <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-red-600 ring-2 ring-white animate-pulse" />
        )}
      </button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
          <div className="absolute right-0 mt-2 w-80 md:w-96 bg-white rounded-xl shadow-xl border border-stone-200 z-50 overflow-hidden animate-fade-in">
            <div className="p-4 border-b border-stone-200 flex items-center justify-between bg-stone-50">
              <div className="flex items-center space-x-2">
                <Bell className="w-4 h-4 text-stone-700" />
                <h4 className="font-serif font-bold text-sm text-stone-900">Newsroom Notifications</h4>
                <span className="bg-stone-200 text-stone-700 text-[10px] font-bold px-2 py-0.5 rounded-full">
                  {notifications.length}
                </span>
              </div>
              <button onClick={() => setIsOpen(false)} className="text-stone-400 hover:text-stone-700">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="max-h-80 overflow-y-auto divide-y divide-stone-100">
              {loading ? (
                <div className="p-8 text-center text-xs text-stone-400">Checking newsroom activity…</div>
              ) : error ? (
                <div className="p-6 text-center text-xs text-stone-500" role="alert">
                  {error}
                  <button onClick={() => void load()} className="block mx-auto mt-2 font-semibold text-stone-700 hover:text-red-700">Retry</button>
                </div>
              ) : notifications.length > 0 ? (
                notifications.map((item) => (
                  <div
                    key={item.id}
                    onClick={() => {
                      if (item.targetView) onNavigate(item.targetView);
                      setIsOpen(false);
                    }}
                    className="p-4 hover:bg-stone-50 transition-colors cursor-pointer space-y-1 group"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-red-700 flex items-center space-x-1">
                        {item.type === 'REVIEW' && <Clock className="w-3 h-3 inline mr-1" />}
                        {item.type === 'COMMENT' && <AlertTriangle className="w-3 h-3 inline mr-1 text-amber-600" />}
                        {item.type}
                      </span>
                      <span className="text-[10px] text-stone-400">{displayTimestamp(item.timestamp)}</span>
                    </div>
                    <p className="text-xs font-semibold text-stone-900 group-hover:text-red-700 transition-colors">
                      {item.title}
                    </p>
                    <p className="text-xs text-stone-500 leading-snug">{item.description}</p>
                  </div>
                ))
              ) : (
                <div className="p-8 text-center text-xs text-stone-400 italic">
                  No active newsroom alerts or pending items.
                </div>
              )}
            </div>

            <div className="p-3 border-t border-stone-100 bg-stone-50 text-center">
              <button
                onClick={() => {
                  onNavigate('articles');
                  setIsOpen(false);
                }}
                className="text-xs font-semibold text-stone-700 hover:text-red-700 transition-colors"
              >
                View Editorial Queue &rarr;
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
