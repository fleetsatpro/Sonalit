import axios from 'axios';

import { attachRefreshInterceptor } from '../../lib/api.js';
import { getCsrfToken } from '../../lib/csrf.js';
import { getAccessToken } from '../../stores/auth.js';

const cdsApi = axios.create({
  baseURL: '/api/v1/cds',
  // Needed for the httpOnly refresh cookie to ride along on /auth/refresh
  // when the interceptor below has to renew an expired access token.
  withCredentials: true,
});

cdsApi.interceptors.request.use((config) => {
  const token = getAccessToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;

  const method = (config.method ?? 'get').toLowerCase();
  if (!['get', 'head', 'options'].includes(method)) {
    const csrf = getCsrfToken();
    if (csrf) config.headers['X-CSRF-Token'] = csrf;
  }
  return config;
});

// Without this, an expired access token turned every CDS call into a dead 401
// — which matters most in the field app, where a device can sit offline past
// the 2h token lifetime and then needs to sync its queued work. Refresh
// failures reject quietly rather than redirecting: the offline queue retries
// in the background, and yanking a yard worker to /login mid-shift would
// throw away queued actions they could otherwise still complete.
attachRefreshInterceptor(cdsApi, { redirectOnFailure: false });

export default cdsApi;
