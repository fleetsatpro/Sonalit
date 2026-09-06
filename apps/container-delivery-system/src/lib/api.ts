import axios from 'axios';

const API_BASE = import.meta.env['VITE_API_BASE_URL'] ?? '/api/v1/cds';

export const api = axios.create({
  baseURL: API_BASE,
  timeout: 15_000,
  withCredentials: true,
});

api.interceptors.request.use((config) => {
  const token = sessionStorage.getItem('cds_token') ?? localStorage.getItem('cds_token');
  if (token) config.headers['Authorization'] = `Bearer ${token}`;
  return config;
});

let refreshPromise: Promise<string> | null = null;

async function refreshAccessToken(): Promise<string> {
  const { data } = await axios.post<{ token: string }>(
    `${API_BASE}/auth/refresh`,
    {},
    { withCredentials: true },
  );
  sessionStorage.setItem('cds_token', data.token);
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
        window.location.href = '/login';
        return Promise.reject(err);
      }
    }
    return Promise.reject(err);
  },
);

export function setAuthToken(token: string) {
  sessionStorage.setItem('cds_token', token);
}

export function clearAuthToken() {
  sessionStorage.removeItem('cds_token');
  localStorage.removeItem('cds_token');
}
