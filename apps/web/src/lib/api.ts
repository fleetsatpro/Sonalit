import axios from 'axios';
import { context, propagation, trace } from '@opentelemetry/api';
import { useAuthStore } from '../stores/auth.js';

const API_BASE =
  import.meta.env['VITE_API_URL'] ??
  'https://sonalit-production.up.railway.app/api/v1';

export const api = axios.create({
  baseURL: API_BASE,
  timeout: 15_000,
});

api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token;
  if (token) config.headers['Authorization'] = `Bearer ${token}`;

  // Inject W3C traceparent/tracestate headers for distributed tracing.
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

api.interceptors.response.use(
  (res) => res,
  async (err) => {
    const original = err.config as typeof err.config & { _retry?: boolean };
    if (err.response?.status === 401 && !original._retry) {
      original._retry = true;
      try {
        const { data } = await axios.post<{ access_token: string; user: import('../stores/auth.js').AuthUser }>(
          `${API_BASE}/auth/refresh`,
          {},
          { withCredentials: true },
        );
        useAuthStore.getState().setAuth(data.access_token, data.user);
        original.headers['Authorization'] = `Bearer ${data.access_token}`;
        return api(original);
      } catch {
        useAuthStore.getState().clearAuth();
        window.location.href = '/login';
      }
    }
    return Promise.reject(err);
  },
);
