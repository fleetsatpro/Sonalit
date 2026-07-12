import axios from 'axios';
import { context, propagation, trace } from '@opentelemetry/api';
import { useAuthStore, getAccessToken, setAccessToken } from '../stores/auth.js';
import { getCsrfToken } from './csrf.js';

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
  const { data } = await axios.post<{ token: string; user: import('../stores/auth.js').AuthUser }>(
    `${API_BASE}/auth/refresh`,
    {},
    { withCredentials: true },
  );
  setAccessToken(data.token);
  useAuthStore.getState().setAuth(data.token, data.user);
  return data.token;
}

api.interceptors.response.use(
  (res) => res,
  async (err) => {
    const original = err.config as typeof err.config & { _retry?: boolean };

    if (err.response?.status === 401 && !original._retry) {
      original._retry = true;

      try {
        if (!refreshPromise) {
          refreshPromise = refreshAccessToken().finally(() => { refreshPromise = null; });
        }
        const token = await refreshPromise;
        original.headers['Authorization'] = `Bearer ${token}`;
        return api(original);
      } catch {
        useAuthStore.getState().clearAuth();
        window.location.href = '/login';
        return Promise.reject(err);
      }
    }

    return Promise.reject(err);
  },
);
