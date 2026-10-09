import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (name: string) => readFileSync(new URL(name, import.meta.url), 'utf8');
const consoleSource = read('./AuthConsole.tsx');
const pageSource = read('./LoginPage.tsx');
const apiSource = read('./authApi.ts');
const readme = read('./README.md');

describe('active login control honesty contract', () => {
  it('does not expose a remember-me preference that the login contract ignores', () => {
    expect(consoleSource).not.toContain('rememberMe');
    expect(consoleSource).not.toContain('Remember me');
    expect(consoleSource).toContain('passwordMutation.mutate({ email: emailVal, password });');
  });

  it('does not mount password-reset or access-request UI without backend routes', () => {
    expect(consoleSource).toContain('Password reset, new-account requests, and SSO are not enabled here.');
    expect(consoleSource).not.toContain('Forgot password?');
    expect(consoleSource).not.toContain('Request access');
    expect(pageSource).not.toContain("from './ForgotPasswordModal'");
    expect(pageSource).not.toContain("from './RequestAccessModal'");
    expect(pageSource).not.toContain('<ForgotPasswordModal');
    expect(pageSource).not.toContain('<RequestAccessModal');
  });

  it('cannot activate nonexistent SSO routes via a build-time feature flag', () => {
    expect(consoleSource).not.toContain('VITE_AUTH_SSO_ENABLED');
    expect(consoleSource).not.toContain('SSO_URLS');
    expect(consoleSource).not.toContain('onSsoGoogle');
    expect(consoleSource).not.toContain('onSsoMicrosoft');
    expect(apiSource).not.toContain('export const SSO_URLS');
  });

  it('preserves implemented password and passkey authentication paths', () => {
    expect(consoleSource).toContain('passwordLogin');
    expect(consoleSource).toContain('getPasskeyOptions');
    expect(consoleSource).toContain('verifyPasskey');
    expect(apiSource).toContain("api.post<AuthResponse>('/auth/login'");
    expect(apiSource).toContain("'/auth/webauthn/authenticate-options'");
    expect(apiSource).toContain("'/auth/webauthn/authenticate'");
  });

  it('documents reset, access request and SSO as unavailable rather than wired', () => {
    expect(readme.match(/\*\*Unavailable\*\*/g)).toHaveLength(4);
    expect(readme).toContain('not exposed until their complete backend security contracts exist');
    expect(apiSource).toContain('@deprecated Inactive modal only; backend route is not implemented.');
  });
});
