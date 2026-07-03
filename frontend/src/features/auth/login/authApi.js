// Wraps the app's existing axios client (src/services/api.js) so the login
// screen talks to the real backend — same interceptors, same base URL, same
// 401 handling. Password login continues to go through useAuthStore.login()
// (defined in src/store/index.js) so the Zustand session hydrates identically
// to every other entry point.
//
// The passkey/SSO/forgot/request-access endpoints below are wired to the paths
// from docs/sonalit-login.html. The backend routes don't exist yet — see the
// TODO(griff) markers.

import api from '../../../services/api';

const API_BASE = import.meta.env.VITE_API_URL || '/api/v1';

export const ENDPOINTS = {
  // Password login → useAuthStore.login() (existing wiring).
  passkeyOptions: `${API_BASE}/auth/passkey/options`,
  passkeyVerify:  `${API_BASE}/auth/passkey/verify`,
  requestReset:   `${API_BASE}/auth/password/forgot`,
  requestAccess:  `${API_BASE}/auth/request-access`,
  ssoGoogle:      `${API_BASE}/auth/sso/google`,
  ssoMicrosoft:   `${API_BASE}/auth/sso/microsoft`,
};

// TODO(griff): backend needs POST /auth/password/forgot — accept { email },
// respond 204 whether or not the email exists (don't leak account presence).
export const requestPasswordReset = (email) =>
  api.post('/auth/password/forgot', { email });

// TODO(griff): backend needs POST /auth/request-access — accept
// { email, organization }, forward to sales inbox / CRM. Rate-limit per IP.
export const requestAccess = (email, organization) =>
  api.post('/auth/request-access', { email, organization });

// TODO(griff): backend needs POST /auth/passkey/options + /auth/passkey/verify
// implementing WebAuthn (challenge issuance + assertion verification). The
// bytes-in/bytes-out shape matches @simplewebauthn if we later swap this
// hand-rolled base64 for the library.
export const getPasskeyOptions = () =>
  api.post('/auth/passkey/options').then((r) => r.data);

export const verifyPasskey = (assertion) =>
  api.post('/auth/passkey/verify', assertion);
