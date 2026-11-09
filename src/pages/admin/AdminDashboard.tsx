/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import {
  FileText,
  Clock,
  CheckCircle,
  Eye,
  Calendar,
  AlertTriangle,
  Activity,
  PlusCircle,
  ArrowUpRight,
  RefreshCw,
  Server,
  Layers,
  MessageSquare
} from 'lucide-react';
import { DashboardDataContract } from '../../modules/admin/types.ts';

interface AdminDashboardProps {
  token: string;
  onNavigate: (view: string, param?: string) => void;
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({ token, onNavigate }) => {
  const [data, setData] = useState<DashboardDataContract | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDashboardData = () => {
    setLoading(true);
    setError(null);
    fetch('/api/admin/dashboard', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => {
        if (!res.ok) throw new Error(`Server returned ${res.status}: Failed to load dashboard metrics`);
        return res.json();
      })
      .then((json: DashboardDataContract) => {
        setData(json);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchDashboardData();
  }, [token]);

  // Loading Skeleton State
  if (loading) {
    return (
      <div className="space-y-8 animate-pulse">
        <div className="h-20 bg-white rounded-2xl border border-stone-200" />
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-32 bg-white rounded-2xl border border-stone-200" />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 h-96 bg-white rounded-2xl border border-stone-200" />
          <div className="h-96 bg-white rounded-2xl border border-stone-200" />
        </div>
      </div>
    );
  }

  // Error State with Retry
  if (error || !data) {
    return (
      <div className="bg-white border border-red-200 rounded-2xl p-8 text-center space-y-4 shadow-sm max-w-lg mx-auto my-12">
        <div className="w-12 h-12 bg-red-100 text-red-700 rounded-full flex items-center justify-center mx-auto">
          <AlertTriangle className="w-6 h-6" />
        </div>
        <div className="space-y-1">
          <h3 className="font-serif font-bold text-lg text-stone-900">Failed to Load Dashboard</h3>
          <p className="text-xs text-stone-600">{error || 'Unable to connect to editorial backend service.'}</p>
        </div>
        <button
          onClick={fetchDashboardData}
          className="bg-stone-900 hover:bg-stone-800 text-white text-xs font-semibold px-4 py-2 rounded-lg inline-flex items-center space-x-2 transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Retry Connection</span>
        </button>
      </div>
    );
  }

  const { metrics, recentlyPublishedStories, recentEditorialActivity, publicationJobs, systemStatus } = data;

  return (
    <div className="space-y-8 pb-12">
      {/* Top Banner & Quick Actions */}
      <div className="bg-white border border-stone-200 rounded-2xl p-6 shadow-2xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
            <h2 className="font-serif font-bold text-2xl text-stone-900">Editorial Command Center</h2>
          </div>
          <p className="text-xs text-stone-500 mt-1">
            Real-time newsroom publishing statistics, review queues, and system telemetry.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => onNavigate('editor-new')}
            className="bg-red-700 hover:bg-red-800 text-white font-semibold px-4 py-2.5 rounded-xl text-xs transition-colors flex items-center space-x-2 shadow-xs"
          >
            <PlusCircle className="w-4 h-4" />
            <span>New Dispatch</span>
          </button>
          <button
            onClick={fetchDashboardData}
            className="bg-stone-100 hover:bg-stone-200 text-stone-700 font-semibold p-2.5 rounded-xl text-xs transition-colors"
            title="Refresh Metrics"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 4 Primary Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <div
          onClick={() => onNavigate('articles')}
          className="bg-white border border-stone-200 rounded-2xl p-6 shadow-2xs hover:border-stone-400 transition-all cursor-pointer group"
        >
          <div className="flex justify-between items-start">
            <span className="text-[11px] font-bold uppercase tracking-wider text-stone-500">Published Dispatches</span>
            <div className="p-2 rounded-lg bg-emerald-50 text-emerald-700 group-hover:scale-110 transition-transform">
              <CheckCircle className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-4">
            <div className="font-serif font-black text-3xl text-stone-900">{metrics.totalPublishedStories}</div>
            <p className="text-[11px] text-stone-500 mt-1 flex items-center space-x-1">
              <Eye className="w-3 h-3 text-stone-400" />
              <span>{metrics.totalViews.toLocaleString()} total verified reads</span>
            </p>
          </div>
        </div>

        <div
          onClick={() => onNavigate('articles')}
          className="bg-white border border-stone-200 rounded-2xl p-6 shadow-2xs hover:border-stone-400 transition-all cursor-pointer group"
        >
          <div className="flex justify-between items-start">
            <span className="text-[11px] font-bold uppercase tracking-wider text-stone-500">Review Queue</span>
            <div className="p-2 rounded-lg bg-amber-50 text-amber-700 group-hover:scale-110 transition-transform">
              <Clock className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-4">
            <div className="font-serif font-black text-3xl text-stone-900">{metrics.draftsAwaitingReview}</div>
            <p className="text-[11px] text-stone-500 mt-1">Awaiting chief editor approval</p>
          </div>
        </div>

        <div
          onClick={() => onNavigate('articles')}
          className="bg-white border border-stone-200 rounded-2xl p-6 shadow-2xs hover:border-stone-400 transition-all cursor-pointer group"
        >
          <div className="flex justify-between items-start">
            <span className="text-[11px] font-bold uppercase tracking-wider text-stone-500">Scheduled Releases</span>
            <div className="p-2 rounded-lg bg-blue-50 text-blue-700 group-hover:scale-110 transition-transform">
              <Calendar className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-4">
            <div className="font-serif font-black text-3xl text-stone-900">{metrics.scheduledStories}</div>
            <p className="text-[11px] text-stone-500 mt-1">Queued for timed publishing</p>
          </div>
        </div>

        <div
          onClick={() => onNavigate('comments')}
          className="bg-white border border-stone-200 rounded-2xl p-6 shadow-2xs hover:border-stone-400 transition-all cursor-pointer group"
        >
          <div className="flex justify-between items-start">
            <span className="text-[11px] font-bold uppercase tracking-wider text-stone-500">Pending Comments</span>
            <div className="p-2 rounded-lg bg-purple-50 text-purple-700 group-hover:scale-110 transition-transform">
              <MessageSquare className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-4">
            <div className="font-serif font-black text-3xl text-stone-900">{metrics.pendingComments}</div>
            <p className="text-[11px] text-stone-500 mt-1">Requires reader moderation</p>
          </div>
        </div>
      </div>

      {/* Business Operations Panel */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="bg-white border border-stone-200 rounded-2xl p-6 shadow-2xs">
          <h3 className="font-serif font-bold text-sm text-stone-900">Breaking News</h3>
          <p className="text-xs text-stone-500 mt-1 mb-4">Manage active alerts.</p>
          <button className="text-xs font-semibold text-red-700 hover:underline" onClick={() => onNavigate('breaking-news')}>Manage Announcements</button>
        </div>
        <div className="bg-white border border-stone-200 rounded-2xl p-6 shadow-2xs">
          <h3 className="font-serif font-bold text-sm text-stone-900">Ad Management</h3>
          <p className="text-xs text-stone-500 mt-1 mb-4">Sponsored image slots.</p>
          <button className="text-xs font-semibold text-red-700 hover:underline" onClick={() => onNavigate('ads')}>Manage Ad Slots</button>
        </div>
        <div className="bg-white border border-stone-200 rounded-2xl p-6 shadow-2xs">
          <h3 className="font-serif font-bold text-sm text-stone-900">Newsletter</h3>
          <p className="text-xs text-stone-500 mt-1 mb-4">Manage subscribers.</p>
          <button className="text-xs font-semibold text-red-700 hover:underline" onClick={() => onNavigate('newsletter')}>View Subscribers</button>
        </div>
        <div className="bg-white border border-stone-200 rounded-2xl p-6 shadow-2xs">
          <h3 className="font-serif font-bold text-sm text-stone-900">Analytics</h3>
          <p className="text-xs text-stone-500 mt-1 mb-4">Engagement dashboard.</p>
          <button className="text-xs font-semibold text-red-700 hover:underline" onClick={() => onNavigate('analytics')}>View Dashboard</button>
        </div>
      </div>

      {/* Main Content Split: Recently Published vs Activity Timeline */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Recently Published Stories (2 cols) */}
        <div className="lg:col-span-2 bg-white border border-stone-200 rounded-2xl p-6 shadow-2xs space-y-6">
          <div className="flex items-center justify-between border-b border-stone-100 pb-4">
            <div className="flex items-center space-x-2">
              <FileText className="w-4 h-4 text-stone-700" />
              <h3 className="font-serif font-bold text-lg text-stone-900">Recently Published Dispatches</h3>
            </div>
            <button
              onClick={() => onNavigate('articles')}
              className="text-xs font-semibold text-red-700 hover:underline flex items-center space-x-1"
            >
              <span>View All</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="divide-y divide-stone-100">
            {recentlyPublishedStories.length > 0 ? (
              recentlyPublishedStories.map((story) => (
                <div key={story.id} className="py-3.5 flex items-center justify-between gap-4 group">
                  <div className="flex items-center space-x-3 min-w-0">
                    {story.coverImage && (
                      <img
                        src={story.coverImage}
                        alt=""
                        className="w-12 h-12 rounded-lg object-cover bg-stone-100 shrink-0 border border-stone-200"
                      />
                    )}
                    <div className="min-w-0">
                      <h4 className="font-serif font-bold text-sm text-stone-900 truncate group-hover:text-red-700 transition-colors">
                        {story.title}
                      </h4>
                      <div className="flex items-center space-x-3 text-[11px] text-stone-500 mt-0.5">
                        <span className="font-semibold text-stone-800">{story.category?.name || 'General'}</span>
                        <span>•</span>
                        <span>{story.author?.name || 'Staff Reporter'}</span>
                        <span>•</span>
                        <span className="flex items-center space-x-1">
                          <Eye className="w-3 h-3 text-stone-400" />
                          <span>{story.views} reads</span>
                        </span>
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={() => onNavigate('editor', story.id)}
                    className="shrink-0 text-xs font-semibold bg-stone-100 hover:bg-stone-200 text-stone-700 px-3 py-1.5 rounded-lg transition-colors"
                  >
                    Edit
                  </button>
                </div>
              ))
            ) : (
              <div className="py-12 text-center text-xs text-stone-400 italic">
                No articles published yet. Click "New Dispatch" to publish your first story.
              </div>
            )}
          </div>
        </div>

        {/* Recent Editorial Activity Feed (1 col) */}
        <div className="bg-white border border-stone-200 rounded-2xl p-6 shadow-2xs space-y-6">
          <div className="flex items-center justify-between border-b border-stone-100 pb-4">
            <div className="flex items-center space-x-2">
              <Activity className="w-4 h-4 text-stone-700" />
              <h3 className="font-serif font-bold text-lg text-stone-900">Editorial Audit Log</h3>
            </div>
            <span className="text-[10px] uppercase font-bold text-stone-400 tracking-wider">Live</span>
          </div>

          <div className="space-y-4">
            {recentEditorialActivity.length > 0 ? (
              recentEditorialActivity.map((event) => (
                <div key={event.id} className="text-xs space-y-1 relative pl-4 border-l-2 border-stone-200">
                  <div className="flex justify-between items-center">
                    <span className="font-bold text-stone-800 uppercase text-[10px] tracking-wider text-red-700">
                      {event.action}
                    </span>
                    <span className="text-[10px] text-stone-400">
                      {new Date(event.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <p className="text-stone-600 leading-snug">{event.details}</p>
                </div>
              ))
            ) : (
              <div className="py-8 text-center text-xs text-stone-400 italic">
                No recent editorial audit events recorded.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Publication Jobs & Background Daemon Status Panel */}
      <div className="bg-white border border-stone-200 rounded-2xl p-6 shadow-2xs space-y-4">
        <div className="flex items-center justify-between border-b border-stone-100 pb-3">
          <div className="flex items-center space-x-2">
            <Server className="w-4 h-4 text-stone-700" />
            <h3 className="font-serif font-bold text-base text-stone-900">Background Publishing Pipeline Health</h3>
          </div>
          <span className="text-xs bg-emerald-50 text-emerald-700 px-2.5 py-0.5 rounded-full font-bold">
            All Daemons Healthy
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {publicationJobs.map((job) => (
            <div key={job.id} className="border border-stone-200 rounded-xl p-4 space-y-2 bg-stone-50/50">
              <div className="flex justify-between items-center">
                <span className="font-bold text-xs text-stone-900">{job.name}</span>
                <span className="text-[10px] font-bold bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded uppercase">
                  {job.status}
                </span>
              </div>
              <p className="text-xs text-stone-500 leading-relaxed">{job.description}</p>
              <p className="text-[10px] text-stone-400">
                Last Heartbeat: {new Date(job.lastRun).toLocaleTimeString()} (Active)
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
