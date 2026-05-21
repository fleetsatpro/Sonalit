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
// If isRefreshing is true when a 401 arrives, a refresh is already in flight —
// do NOT retry again; clear auth and redirect to login instead.
let isRefreshing = false;

api.interceptors.response.use(
  (res) => res,
  async (err) => {
    const original = err.config as typeof err.config & { _retry?: boolean };

    if (err.response?.status === 401 && !original._retry) {
      // Infinite-loop guard: if we already tried a refresh, give up
      if (isRefreshing) {
        useAuthStore.getState().clearAuth();
        window.location.href = '/login';
        return Promise.reject(err);
      }

      original._retry = true;
      isRefreshing = true;

      try {
        const { data } = await axios.post<{ token: string; user: import('../stores/auth.js').AuthUser }>(
          `${API_BASE}/auth/refresh`,
          {},
          { withCredentials: true },
        );
        setAccessToken(data.token);
        useAuthStore.getState().setAuth(data.token, data.user);
        original.headers['Authorization'] = `Bearer ${data.token}`;
        return api(original);
      } catch {
        useAuthStore.getState().clearAuth();
        window.location.href = '/login';
        return Promise.reject(err);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(err);
  },
);
