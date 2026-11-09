/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phase 9: minimal path router for the existing React/Vite SPA.
 *
 * Why homegrown (~100 LOC, zero deps): the app is callback-driven
 * (onSelectArticle etc.); this router preserves that architecture while adding
 * REAL URLs — pushState deep links, refresh, back/forward via popstate.
 * The Express dev/prod fallback serves index.html for every non-API path, so
 * server support for deep links already exists; only the client needed this.
 *
 * Not a framework migration and no routing library introduced.
 */

import { useEffect, useState, useCallback } from 'react';

export interface RouteState {
  /** Full pathname, e.g. "/article/some-slug". */
  path: string;
  /** Parsed query params of the current URL. */
  query: URLSearchParams;
}

function readLocation(): RouteState {
  return {
    path: window.location.pathname,
    query: new URLSearchParams(window.location.search),
  };
}

export interface Router {
  state: RouteState;
  /** Push a new URL (or replace without a history entry). */
  navigate: (to: string, opts?: { replace?: boolean }) => void;
}

/**
 * Route provider as a hook + context-free pattern: App calls useRouter() and
 * derives view state; subscribers re-render on pushState/popstate.
 * Format invariant: `to` is an in-app absolute path ("[?query]") — builders in
 * src/urls.ts guarantee this.
 */
export function useRouter(): Router {
  const [state, setState] = useState<RouteState>(() => readLocation());

  useEffect(() => {
    const sync = () => setState(readLocation());
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, []);

  const navigate = useCallback((to: string, opts?: { replace?: boolean }) => {
    if (opts?.replace) {
      window.history.replaceState({}, '', to);
    } else {
      window.history.pushState({}, '', to);
    }
    setState(readLocation());
    // Content pages scroll to their anchor on navigation; history entries
    // restore their own scroll automatically (browsers' scrollRestoration).
    if (!opts?.replace) window.scrollTo(0, 0);
  }, []);

  return { state, navigate };
}
