import { context, propagation, trace } from '@opentelemetry/api';
import axios from 'axios';

import { useAuthStore, getAccessToken, setAccessToken } from '../stores/auth.js';

import { getCsrfToken } from './csrf.js';

import type { AuthUser } from '../stores/auth.js';

const API_BASE = import.meta.env['VITE_API_BASE_URL'] ?? '/api/v1';

export const api = axios.create({
  baseURL: API_BASE,
  timeout: 15_000,
  withCredentials: true, // send httpOnly refresh-token cookie on every request (T1.2)
});

api.interceptors.request.use((config) => {
  // Access token lives in memory only — never in localStorage (T1.2)
  const token = getAccessToken();
  if (token) config.headers['Authorization'] = `Bearer ${token}`;

  // Double-submit CSRF cookie — attach on state-changing methods (BL-001)
  const method = (config.method ?? 'get').toLowerCase();
  if (!['get', 'head', 'options'].includes(method)) {
    const csrf = getCsrfToken();
    if (csrf) config.headers['X-CSRF-Token'] = csrf;
  }

  // W3C distributed tracing headers
  const span = trace.getActiveSpan();
  if (span) {
    const carrier: Record<string, string> = {};
    propagation.inject(context.active(), carrier);
    for (const [key, value] of Object.entries(carrier)) {
      config.headers[key] = value;
    }
  }

  return config;
});

// ── Refresh interceptor with infinite-loop guard (T1.2) ───────────────────────
// Several requests can 401 at once (a page mounts and fires multiple calls
// right as the access token expires). They all share this one in-flight
// refresh promise instead of racing separate /auth/refresh calls — the
// previous isRefreshing boolean treated "a refresh is already running" as
// "give up and log out", which force-logged-out users mid-session any time
// two or more requests happened to expire together.
let refreshPromise: Promise<string> | null = null;

async function refreshAccessToken(): Promise<string> {
  // /auth/refresh is NOT in the backend's CSRF skip list (unlike /auth/login),
  // so it needs the double-submit header like any other mutating call. Without
  // it every refresh 403s, and since a failed refresh clears auth and bounces
  // to /login, the symptom is being logged out on any page reload — the
  // in-memory access token is gone, the first 401 triggers a refresh, and the
  // refresh can never succeed. This is a bare axios call rather than `api`, so
  // it doesn't inherit the request interceptor that would have added it.
  const csrf = getCsrfToken();
  const { data } = await axios.post<{ token: string; user: AuthUser }>(
    `${API_BASE}/auth/refresh`,
    {},
    { withCredentials: true, headers: csrf ? { 'X-CSRF-Token': csrf } : {} },
  );
  setAccessToken(data.token);
  useAuthStore.getState().setAuth(data.token, data.user);
  return data.token;
}

/**
 * Attach the 401 → refresh → replay behaviour to an axios instance.
 *
 * Exported so other instances (notably the CDS client in pages/cds/api.ts)
 * get the same treatment instead of hard-failing the moment an access token
 * expires. They deliberately share the module-scoped `refreshPromise` above,
 * so two instances 401-ing at once still make exactly one /auth/refresh call.
 *
 * `redirectOnFailure` is opt-out for callers that must not have the page
 * yanked out from under them on a failed refresh — the field app's offline
 * queue flushes in the background, and bouncing a yard worker to /login
 * mid-shift would discard queued work they can still complete.
 */
export function attachRefreshInterceptor(
  instance: typeof api,
  { redirectOnFailure = true }: { redirectOnFailure?: boolean } = {},
): void {
  instance.interceptors.response.use(
    (res) => res,
    async (err) => {
      const original = err.config as typeof err.config & { _retry?: boolean };

      if (err.response?.status === 401 && original && !original._retry) {
        original._retry = true;

        try {
          if (!refreshPromise) {
            refreshPromise = refreshAccessToken().finally(() => { refreshPromise = null; });
          }
          const token = await refreshPromise;
          original.headers['Authorization'] = `Bearer ${token}`;
          return instance(original);
        } catch {
          if (redirectOnFailure) {
            useAuthStore.getState().clearAuth();
            window.location.href = '/login';
          }
          throw err;
        }
      }

      throw err;
    },
  );
}

attachRefreshInterceptor(api);
