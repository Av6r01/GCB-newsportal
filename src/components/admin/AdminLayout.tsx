/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import {
  Shield,
  FileText,
  MessageSquare,
  Home,
  LogOut,
  Menu,
  X,
  Search,
  PlusCircle,
  BarChart2,
  Settings,
  ChevronLeft,
  ChevronRight,
  User as UserIcon,
  AlertOctagon,
  Lock,
  Image,
  LayoutGrid,
  Megaphone,
  CircleDollarSign,
  Mail,
  Tags,
  UserRound,
  Users,
  ArrowRightLeft,
  ListChecks
} from 'lucide-react';
import { AdminBreadcrumbs, BreadcrumbSegment } from './AdminBreadcrumbs.tsx';
import { AdminNotifications } from './AdminNotifications.tsx';
import { hasPermission, RoleType } from '../../modules/auth/permissions.ts';

interface AdminLayoutProps {
  user: any;
  /** Bearer token for the real notifications endpoint (GET /api/admin/notifications). */
  token: string;
  currentSubView: string;
  onNavigate: (view: string) => void;
  onLogout: () => void;
  onReturnToPortal: () => void;
  breadcrumbs: BreadcrumbSegment[];
  children: React.ReactNode;
}

export const AdminLayout: React.FC<AdminLayoutProps> = ({
  user,
  token,
  currentSubView,
  onNavigate,
  onLogout,
  onReturnToPortal,
  breadcrumbs,
  children
}) => {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [userDropdownOpen, setUserDropdownOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Access Denied (403) check: Readers are barred from admin interface
  if (!user || user.role === 'READER') {
    return (
      <div className="min-h-screen bg-stone-100 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white border border-stone-200 rounded-2xl p-8 text-center shadow-lg space-y-6">
          <div className="w-16 h-16 bg-red-100 text-red-700 rounded-full flex items-center justify-center mx-auto">
            <Lock className="w-8 h-8" />
          </div>
          <div className="space-y-2">
            <h2 className="font-serif font-bold text-2xl text-stone-900">403: Access Denied</h2>
            <p className="text-sm text-stone-600">
              Your account ({user?.email || 'Anonymous'}) does not have accredited newsroom credentials to access the editorial CMS.
            </p>
          </div>
          <div className="pt-2">
            <button
              onClick={onReturnToPortal}
              className="w-full bg-stone-900 hover:bg-stone-800 text-white font-semibold py-2.5 rounded-lg text-sm transition-colors"
            >
              Return to Public Portal
            </button>
          </div>
        </div>
      </div>
    );
  }

  /**
   * Phase 10: complete CMS navigation, grouped into sections and gated by the
   * same permission matrix that protects each server endpoint. Every entry
   * routes to a real screen; nothing navigates to a dead destination.
   */
  const navSections: Array<{ heading: string; items: Array<{ id: string; label: string; icon: any; show: boolean }> }> = [
    {
      heading: 'Desk',
      items: [
        { id: 'dashboard', label: 'Command Center', icon: Shield, show: true },
        { id: 'articles', label: 'Articles & Queues', icon: FileText, show: true },
        { id: 'editor-new', label: 'New Dispatch', icon: PlusCircle, show: true },
        { id: 'media', label: 'Media Library', icon: Image, show: true },
        { id: 'comments', label: 'Comment Moderation', icon: MessageSquare, show: true },
      ],
    },
    {
      heading: 'Setup',
      items: [
        { id: 'layout', label: 'Homepage Layout', icon: LayoutGrid, show: true },
        { id: 'taxonomy', label: 'Categories & Topics', icon: Tags, show: hasPermission(user.role as RoleType, 'categories:manage') },
        { id: 'breaking-news', label: 'Breaking News', icon: Megaphone, show: true },
      ],
    },
    {
      heading: 'Audience',
      items: [
        { id: 'newsletter', label: 'Newsletter Friends', icon: Mail, show: hasPermission(user.role as RoleType, 'users:view') },
        { id: 'analytics', label: 'Analytics', icon: BarChart2, show: hasPermission(user.role as RoleType, 'analytics:view') },
      ],
    },
    {
      heading: 'Operations',
      items: [
        { id: 'jobs', label: 'Publishing Pipeline', icon: ListChecks, show: hasPermission(user.role as RoleType, 'analytics:view') },
        { id: 'staff', label: 'Staff Accounts', icon: Users, show: hasPermission(user.role as RoleType, 'users:manage') },
        { id: 'authors', label: 'Author Profiles', icon: UserRound, show: true },
        { id: 'ads', label: 'Ad Slots', icon: CircleDollarSign, show: hasPermission(user.role as RoleType, 'ad:manage') },
        { id: 'redirects', label: 'URL Redirects', icon: ArrowRightLeft, show: hasPermission(user.role as RoleType, 'settings:manage') },
        { id: 'settings', label: 'Site Settings', icon: Settings, show: hasPermission(user.role as RoleType, 'settings:manage') },
      ],
    },
  ];

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      onNavigate(`search:${searchQuery.trim()}`);
    }
  };

  return (
    <div className="min-h-screen bg-stone-100 flex flex-col antialiased">
      {/* Top Application Bar */}
      <header className="bg-white border-b border-stone-200 sticky top-0 z-30 shadow-2xs">
        <div className="px-4 md:px-6 py-3 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            {/* Mobile Drawer Button */}
            <button
              onClick={() => setMobileDrawerOpen(true)}
              className="lg:hidden p-2 rounded-lg text-stone-600 hover:bg-stone-100"
            >
              <Menu className="w-5 h-5" />
            </button>

            {/* Desktop Collapse Toggle */}
            <button
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              className="hidden lg:flex p-1.5 rounded-lg text-stone-500 hover:bg-stone-100 transition-colors"
              title={sidebarCollapsed ? 'Expand Sidebar' : 'Collapse Sidebar'}
            >
              {sidebarCollapsed ? <ChevronRight className="w-5 h-5" /> : <ChevronLeft className="w-5 h-5" />}
            </button>

            {/* Brand Logo */}
            <button onClick={() => onNavigate('dashboard')} className="flex items-center space-x-2.5">
              <div className="bg-stone-900 text-white font-serif font-black text-lg px-2.5 py-1 rounded">
                GC
              </div>
              <span className="font-serif font-bold text-stone-900 hidden sm:inline text-base">
                Newsroom CMS
              </span>
            </button>

            <span className="text-stone-300 hidden md:inline">|</span>

            {/* Breadcrumb Navigation */}
            <div className="hidden md:block">
              <AdminBreadcrumbs segments={breadcrumbs} />
            </div>
          </div>

          {/* Search, Notifications & User Profile */}
          <div className="flex items-center space-x-3">
            {/* Search Input */}
            <form onSubmit={handleSearchSubmit} className="hidden sm:flex items-center relative w-48 lg:w-64">
              <input
                type="text"
                placeholder="Search CMS..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-stone-50 border border-stone-200 rounded-lg pl-8 pr-3 py-1.5 text-xs focus:outline-none focus:border-stone-800 transition-colors"
              />
              <Search className="w-3.5 h-3.5 text-stone-400 absolute left-2.5 pointer-events-none" />
            </form>

            {/* Notifications Dropdown — real events from /api/admin/notifications */}
            <AdminNotifications token={token} onNavigate={onNavigate} />

            {/* User Profile Dropdown */}
            <div className="relative">
              <button
                onClick={() => setUserDropdownOpen(!userDropdownOpen)}
                className="flex items-center space-x-2 p-1.5 rounded-lg hover:bg-stone-100 transition-colors"
              >
                <div className="w-7 h-7 rounded-full bg-stone-900 text-white flex items-center justify-center font-bold text-xs uppercase">
                  {user.name?.charAt(0) || 'U'}
                </div>
                <div className="hidden lg:block text-left text-xs">
                  <div className="font-semibold text-stone-800 leading-tight">{user.name}</div>
                  <div className="text-[10px] text-stone-500 uppercase tracking-wider font-bold text-red-700">
                    {user.role}
                  </div>
                </div>
              </button>

              {userDropdownOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setUserDropdownOpen(false)} />
                  <div className="absolute right-0 mt-2 w-56 bg-white rounded-xl shadow-xl border border-stone-200 z-50 py-2 divide-y divide-stone-100 animate-fade-in">
                    <div className="px-4 py-2 text-xs">
                      <p className="font-bold text-stone-900">{user.name}</p>
                      <p className="text-stone-500 truncate">{user.email}</p>
                      <span className="inline-block mt-1 bg-red-100 text-red-800 text-[9px] font-bold px-2 py-0.5 rounded-full uppercase">
                        {user.role}
                      </span>
                    </div>

                    <div className="py-1 text-xs">
                      <button
                        onClick={() => {
                          onReturnToPortal();
                          setUserDropdownOpen(false);
                        }}
                        className="w-full text-left px-4 py-2 hover:bg-stone-50 text-stone-700 flex items-center space-x-2"
                      >
                        <Home className="w-4 h-4 text-stone-400" />
                        <span>Public News Portal</span>
                      </button>
                    </div>

                    <div className="py-1 text-xs">
                      <button
                        onClick={() => {
                          onLogout();
                          setUserDropdownOpen(false);
                        }}
                        className="w-full text-left px-4 py-2 hover:bg-red-50 text-red-700 flex items-center space-x-2 font-semibold"
                      >
                        <LogOut className="w-4 h-4" />
                        <span>Sign Out</span>
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Main Workspace with Responsive Sidebar */}
      <div className="flex-1 flex overflow-hidden">
        {/* Desktop Sidebar */}
        <aside
          className={`hidden lg:flex flex-col justify-between bg-stone-900 text-stone-300 transition-all duration-300 border-r border-stone-800 ${
            sidebarCollapsed ? 'w-20' : 'w-64'
          }`}
        >
          <div className="p-4 space-y-5 overflow-y-auto">
            {navSections.map((section) => {
              const visible = section.items.filter((item) => item.show);
              if (visible.length === 0) return null;
              return (
                <div key={section.heading}>
                  {!sidebarCollapsed && (
                    <p className="px-3 pb-1.5 text-[10px] font-bold uppercase tracking-widest text-stone-500">{section.heading}</p>
                  )}
                  <nav className="space-y-1">
                    {visible.map((item) => {
                      const Icon = item.icon;
                      const isActive = currentSubView === item.id;
                      return (
                        <button
                          key={item.id}
                          onClick={() => onNavigate(item.id)}
                          className={`w-full flex items-center space-x-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                            isActive
                              ? 'bg-red-700 text-white shadow-xs'
                              : 'hover:bg-stone-800 text-stone-300'
                          }`}
                          title={sidebarCollapsed ? item.label : undefined}
                        >
                          <Icon className="w-5 h-5 shrink-0" />
                          {!sidebarCollapsed && <span className="truncate">{item.label}</span>}
                        </button>
                      );
                    })}
                  </nav>
                </div>
              );
            })}
          </div>

          <div className="p-4 border-t border-stone-800 space-y-2">
            <button
              onClick={onReturnToPortal}
              className={`w-full flex items-center space-x-3 px-3 py-2 rounded-lg text-xs font-semibold text-stone-400 hover:text-white hover:bg-stone-800 transition-colors ${
                sidebarCollapsed ? 'justify-center' : ''
              }`}
              title="Return to Public Portal"
            >
              <Home className="w-4 h-4 shrink-0" />
              {!sidebarCollapsed && <span>Public Portal</span>}
            </button>
            <button
              onClick={onLogout}
              className={`w-full flex items-center space-x-3 px-3 py-2 rounded-lg text-xs font-semibold text-stone-400 hover:text-red-400 hover:bg-stone-800 transition-colors ${
                sidebarCollapsed ? 'justify-center' : ''
              }`}
              title="Sign Out"
            >
              <LogOut className="w-4 h-4 shrink-0" />
              {!sidebarCollapsed && <span>Sign Out</span>}
            </button>
          </div>
        </aside>

        {/* Mobile Slide-Over Drawer */}
        {mobileDrawerOpen && (
          <div className="lg:hidden fixed inset-0 z-50 flex">
            <div className="fixed inset-0 bg-black/60 backdrop-blur-xs" onClick={() => setMobileDrawerOpen(false)} />
            <div className="relative w-64 max-w-xs bg-stone-900 text-white p-6 flex flex-col justify-between shadow-2xl z-50 animate-slide-in overflow-y-auto">
              <div className="space-y-6">
                <div className="flex items-center justify-between pb-4 border-b border-stone-800">
                  <div className="flex items-center space-x-2">
                    <div className="bg-red-700 text-white font-serif font-black px-2 py-0.5 rounded">GC</div>
                    <span className="font-serif font-bold text-white text-base">Newsroom CMS</span>
                  </div>
                  <button onClick={() => setMobileDrawerOpen(false)} className="text-stone-400 hover:text-white">
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <nav className="space-y-1 pb-2">
                  {navSections.flatMap((section) => section.items.filter((item) => item.show)).map((item) => {
                    const Icon = item.icon;
                    const isActive = currentSubView === item.id;
                    return (
                      <button
                        key={item.id}
                        onClick={() => {
                          onNavigate(item.id);
                          setMobileDrawerOpen(false);
                        }}
                        className={`w-full flex items-center space-x-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                          isActive ? 'bg-red-700 text-white' : 'hover:bg-stone-800 text-stone-300'
                        }`}
                      >
                        <Icon className="w-5 h-5 shrink-0" />
                        <span>{item.label}</span>
                      </button>
                    );
                  })}
                </nav>
              </div>

              <div className="pt-6 border-t border-stone-800 space-y-2">
                <button
                  onClick={() => {
                    onReturnToPortal();
                    setMobileDrawerOpen(false);
                  }}
                  className="w-full flex items-center space-x-3 px-3 py-2 rounded-lg text-xs font-semibold text-stone-400 hover:text-white"
                >
                  <Home className="w-4 h-4" />
                  <span>Public Portal</span>
                </button>
                <button
                  onClick={onLogout}
                  className="w-full flex items-center space-x-3 px-3 py-2 rounded-lg text-xs font-semibold text-red-400 hover:text-red-300"
                >
                  <LogOut className="w-4 h-4" />
                  <span>Sign Out</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Main Admin Scrollable Viewport */}
        <main className="flex-1 overflow-y-auto p-4 md:p-8 space-y-6">
          {children}
        </main>
      </div>
    </div>
  );
};
