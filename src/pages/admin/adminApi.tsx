/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phase 10: shared admin-panel plumbing — authenticated JSON fetch with
 * ALWAYS-generic error messaging (wire responses from the server are safe;
 * high-level labels here never echo drivers/stacks).
 */
import React from 'react';

export interface AdminApiError {
  message: string;
  status: number;
}

export function adminApi(token: string) {
  const request = async <T,>(path: string, init?: RequestInit): Promise<T> => {
    let status = 0;
    try {
      const res = await fetch(path, {
        ...init,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          ...(init?.headers || {}),
        },
      });
      status = res.status;
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const message = typeof (json as any)?.error === 'string' ? (json as any).error : `Server returned ${res.status}.`;
        throw { message, status } as AdminApiError;
      }
      return json as T;
    } catch (err: any) {
      if (err && typeof err === 'object' && 'message' in err && 'status' in err) throw err;
      // network-level failure
      throw { message: 'Cannot reach the editorial backend service.', status: 0 } as AdminApiError;
    }
  };
  return {
    get: <T,>(path: string) => request<T>(path),
    post: <T,>(path: string, body: unknown) => request<T>(path, { method: 'POST', body: JSON.stringify(body) }),
    put: <T,>(path: string, body: unknown) => request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
    del: <T,>(path: string) => request<T>(path, { method: 'DELETE' }),
  };
}

/** Standard panel header used by every management screen. */
export function AdminPanelHeader({ title, description, children }: { title: string; description: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-stone-200 pb-4">
      <div>
        <h2 className="font-serif font-bold text-2xl text-stone-900">{title}</h2>
        <p className="text-xs text-stone-500 mt-1">{description}</p>
      </div>
      {children && <div className="flex items-center gap-2">{children}</div>}
    </div>
  );
}

/** Inline notice attributed to a missing/unconfigured external provider. */
export function NotConfiguredNotice({ service, reason }: { service: string; reason: string }) {
  return (
    <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-xl p-3 text-xs leading-relaxed" role="note">
      <span className="font-bold uppercase tracking-wider">Not configured:</span>{' '}
      {service}. {reason}
    </div>
  );
}

export function ApiErrorBanner({ error, onRetry }: { error: AdminApiError | null; onRetry?: (e: React.MouseEvent) => void }) {
  if (!error) return null;
  return (
    <div className="bg-red-50 border border-red-200 text-red-800 rounded-xl p-3 text-xs flex items-center justify-between gap-3" role="alert">
      <span>{error.message}</span>
      {onRetry && (
        <button onClick={onRetry} className="font-bold underline hover:no-underline shrink-0" title={error.message}>
          Retry
        </button>
      )}
    </div>
  );
}
