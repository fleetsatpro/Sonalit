// Wraps the app's existing axios client (../../lib/api.ts) so the login screen
// talks to the real backend — same interceptors, same base URL, same 401 +
// refresh handling. Password + passkey login use react-query mutations at the
// AuthConsole call sites so we match the app's existing convention.
//
// WebAuthn endpoints match what the current production Login.tsx uses:
//   GET  /auth/webauthn/authenticate-options?email=…
//   POST /auth/webauthn/authenticate
// The reference HTML used /auth/passkey/*; we deliberately use the real,
// currently-deployed paths.
//
// request-access is implemented (backend/src/routes/auth.js). forgot-password
// still is not — its TODO(griff) marker is at the call site below.

import { api } from '../../../lib/api';
import type { AuthUser } from '../../../stores/auth';

export type AuthResponse = { token: string; user: AuthUser };

export type WebAuthnOptions = {
  challenge: string;
  allowCredentials?: { id: string; type: string; transports?: string[] }[];
  rpId?: string;
  timeout?: number;
  userVerification?: AuthenticatorSelectionCriteria['userVerification'];
};

// TODO(griff): backend needs POST /auth/password/forgot — accept { email },
// respond 204 whether or not the email exists (don't leak account presence).
export const requestPasswordReset = (email: string): Promise<unknown> =>
  api.post('/auth/password/forgot', { email });

/**
 * Access requests and public contact enquiries both post here. The backend
 * records the row before it tries to send mail, so a 202 means the request is
 * safely stored — not necessarily that an email has already gone out.
 */
export interface AccessRequest {
  email: string;
  organization?: string;
  name?: string;
  message?: string;
  /** Which form it came from — drives the subject line of the ops email. */
  source?: 'login' | 'contact';
}

export const submitAccessRequest = (payload: AccessRequest): Promise<unknown> =>
  api.post('/auth/request-access', payload);

export const requestAccess = (email: string, organization: string): Promise<unknown> =>
  submitAccessRequest({ email, organization, source: 'login' });

// WebAuthn — these paths ARE implemented in production today.
export const getPasskeyOptions = (email: string): Promise<WebAuthnOptions> =>
  api.get<WebAuthnOptions>('/auth/webauthn/authenticate-options', { params: { email } }).then((r) => r.data);

export const verifyPasskey = (assertion: {
  id: string; rawId: string; type: string;
  response: { authenticatorData: string; clientDataJSON: string; signature: string; userHandle: string | null };
}): Promise<AuthResponse> =>
  api.post<AuthResponse>('/auth/webauthn/authenticate', assertion).then((r) => r.data);

export const passwordLogin = (email: string, password: string): Promise<AuthResponse> =>
  api.post<AuthResponse>('/auth/login', { email, password }).then((r) => r.data);

// base64url helpers — WebAuthn buffers use base64url over the wire.
export function base64UrlToBuffer(b: string): ArrayBuffer {
  const base64 = b.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

export function bufferToBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

// SSO redirect targets — backend needs these routes; frontend just navigates.
// TODO(griff): backend needs OAuth start routes /auth/sso/google + /auth/sso/microsoft.
export const SSO_URLS = {
  google:    '/api/v1/auth/sso/google',
  microsoft: '/api/v1/auth/sso/microsoft',
};
