/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Lock, Mail, ArrowLeft, ShieldCheck, KeyRound } from 'lucide-react';

interface AdminLoginProps {
  onSuccess: (user: any, token: string) => void;
  onReturnToPortal: () => void;
}

export const AdminLogin: React.FC<AdminLoginProps> = ({ onSuccess, onReturnToPortal }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Authentication failed. Please verify credentials.');
      }

      onSuccess(data.user, data.token);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleQuickFill = (demoEmail: string, demoPass: string) => {
    setEmail(demoEmail);
    setPassword(demoPass);
    setError('');
  };

  return (
    <div className="min-h-screen bg-stone-100 flex flex-col justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <button
          onClick={onReturnToPortal}
          className="flex items-center space-x-1.5 text-xs font-semibold text-stone-500 hover:text-stone-900 transition-colors mb-6 mx-auto"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Return to Public News Portal</span>
        </button>

        <div className="bg-stone-900 text-white font-serif font-black text-3xl w-14 h-14 rounded-2xl flex items-center justify-center mx-auto shadow-md">
          GC
        </div>
        <h2 className="mt-4 text-center font-serif font-bold text-3xl text-stone-900">
          Newsroom Editorial CMS
        </h2>
        <p className="mt-1 text-center text-xs text-stone-500 uppercase tracking-widest font-semibold">
          Authorized Staff Authentication
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-6 shadow-xl rounded-2xl border border-stone-200 sm:px-10 space-y-6">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-xs font-medium animate-shake">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-stone-600 mb-1">
                Newsroom Email
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-stone-400 absolute left-3 top-3.5 pointer-events-none" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="editor@globalchronicle.news"
                  className="w-full bg-stone-50 border border-stone-300 rounded-xl pl-10 pr-4 py-2.5 text-sm focus:outline-none focus:border-stone-800"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-stone-600 mb-1">
                Password
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-stone-400 absolute left-3 top-3.5 pointer-events-none" />
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full bg-stone-50 border border-stone-300 rounded-xl pl-10 pr-4 py-2.5 text-sm focus:outline-none focus:border-stone-800"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-stone-900 hover:bg-stone-800 text-white font-semibold py-3 rounded-xl text-sm transition-colors shadow-sm disabled:opacity-50 flex items-center justify-center space-x-2"
            >
              {loading ? (
                <span>Authenticating credentials...</span>
              ) : (
                <>
                  <KeyRound className="w-4 h-4" />
                  <span>Sign In to Newsroom</span>
                </>
              )}
            </button>
          </form>

          {/* Quick Credential Presets for Reviewers */}
          <div className="pt-4 border-t border-stone-200 space-y-2">
            <p className="text-[11px] font-bold uppercase tracking-wider text-stone-500 text-center">
              Quick Test Credentials
            </p>
            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <button
                type="button"
                onClick={() => handleQuickFill('admin@globalchronicle.news', 'admin123')}
                className="p-2 border border-stone-200 hover:border-stone-400 rounded-lg text-left bg-stone-50 transition-colors"
              >
                <div className="font-bold text-stone-900">Chief Editor</div>
                <div className="text-stone-500">ADMIN</div>
              </button>
              <button
                type="button"
                onClick={() => handleQuickFill('journalist@globalchronicle.news', 'writer123')}
                className="p-2 border border-stone-200 hover:border-stone-400 rounded-lg text-left bg-stone-50 transition-colors"
              >
                <div className="font-bold text-stone-900">Staff Writer</div>
                <div className="text-stone-500">JOURNALIST</div>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
