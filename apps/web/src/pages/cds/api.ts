import axios from 'axios';

import { attachConnectivityReporter, attachRefreshInterceptor } from '../../lib/api.js';
import { getCsrfToken } from '../../lib/csrf.js';
import { announceFieldSessionExpired, fieldAuthHeaders } from '../../lib/fieldSession.js';
import { getAccessToken } from '../../stores/auth.js';

const cdsApi = axios.create({
  baseURL: '/api/v1/cds',
  // Needed for the httpOnly refresh cookie to ride along on /auth/refresh
  // when the interceptor below has to renew an expired access token.
  withCredentials: true,
});

cdsApi.interceptors.request.use((config) => {
  // The Field app reaches the same clamp/unclamp routes as the dashboard, but
  // on device + PIN credentials (lib/fieldSession.ts, backend/src/middleware/
  // fieldAuth.js). When those are present they are the *only* credentials
  // sent: no Bearer token, no CSRF header, and cookies switched off for the
  // request. A yard tablet must never be able to act on an operator session
  // that happens to be alive in the same browser — that isolation is the
  // whole point of the separate login.
  const field = fieldAuthHeaders();
  if (Object.keys(field).length > 0) {
    for (const [k, v] of Object.entries(field)) config.headers[k] = v;
    config.withCredentials = false;
    return config;
  }

  const token = getAccessToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;

  const method = (config.method ?? 'get').toLowerCase();
  if (!['get', 'head', 'options'].includes(method)) {
    const csrf = getCsrfToken();
    if (csrf) config.headers['X-CSRF-Token'] = csrf;
  }
  return config;
});

// A rejected field session must not fall through to the operator refresh flow
// below — /auth/refresh would either fail or, worse, hand a yard tablet an
// operator token. Clear the shift session and let the field app drop to its
// PIN screen instead.
cdsApi.interceptors.response.use(
  (res) => res,
  (err) => {
    const status = err?.response?.status;
    const sentFieldAuth = Boolean(err?.config?.headers?.['X-Field-Token']);
    if (sentFieldAuth && (status === 401 || status === 403)) {
      // 403 covers a revoked device and a role change mid-shift; both mean the
      // worker has to sign in again rather than retry.
      announceFieldSessionExpired();
      // Mark it retried so the refresh interceptor registered below leaves it
      // alone. Interceptor order would do that today, but relying on order for
      // a rule as consequential as "never trade a field 401 for an operator
      // token" is the kind of thing a later edit silently breaks.
      if (err.config) err.config._retry = true;
    }
    throw err;
  },
);

// Field-session 401s are handled above: they mark the request as already
// retried and emit FIELD_SESSION_EXPIRED_EVENT, so they never enter the operator
// refresh/redirect path. For operator requests, a failed refresh must clear the
// stale operator session and return to login rather than leaving the CDS screen
// mounted with a misleading "analytics unavailable" error.
attachRefreshInterceptor(cdsApi);

// The field app makes almost all of its requests through this instance, so
// without it the connectivity manager would be blind on exactly the surface
// where connectivity matters most.
attachConnectivityReporter(cdsApi);

export default cdsApi;
