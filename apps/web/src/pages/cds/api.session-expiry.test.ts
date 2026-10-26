import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';

const mocks = vi.hoisted(() => ({
  clearAuth: vi.fn(),
  getAccessToken: vi.fn(() => null),
  setAccessToken: vi.fn(),
  getCsrfToken: vi.fn(() => null),
  fieldAuthHeaders: vi.fn(() => ({})),
  announceFieldSessionExpired: vi.fn(),
  reportRequestOutcome: vi.fn(),
}));

vi.mock('../../stores/auth.js', () => ({
  getAccessToken: mocks.getAccessToken,
  setAccessToken: mocks.setAccessToken,
  useAuthStore: {
    getState: () => ({
      clearAuth: mocks.clearAuth,
      setAuth: vi.fn(),
    }),
  },
}));

vi.mock('../../lib/csrf.js', () => ({
  getCsrfToken: mocks.getCsrfToken,
}));

vi.mock('../../lib/fieldSession.js', () => ({
  announceFieldSessionExpired: mocks.announceFieldSessionExpired,
  fieldAuthHeaders: mocks.fieldAuthHeaders,
}));

vi.mock('../../lib/offline/connectivity.js', () => ({
  reportRequestOutcome: mocks.reportRequestOutcome,
}));

import cdsApi from './api.js';

type RejectedResponseHandler = {
  rejected?: (error: unknown) => unknown;
};

async function dispatchRejectedResponse(error: unknown): Promise<unknown> {
  const handlers = (cdsApi.interceptors.response as unknown as { handlers: RejectedResponseHandler[] }).handlers;
  let currentError = error;

  // Axios response-error interceptors execute in registration order. Dispatch
  // them explicitly so this test verifies the same field-auth/refresh boundary
  // without making a network request.
  for (const handler of handlers) {
    if (!handler?.rejected) continue;
    try {
      await handler.rejected(currentError);
      return undefined;
    } catch (nextError) {
      currentError = nextError;
    }
  }
  return currentError;
}

describe('CDS API session expiry handling', () => {
  let fakeWindow: { location: { href: string }; dispatchEvent: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fieldAuthHeaders.mockReturnValue({});
    fakeWindow = { location: { href: '/cds/analytics' }, dispatchEvent: vi.fn() };
    vi.stubGlobal('window', fakeWindow);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('clears a stale operator session and redirects when token refresh fails', async () => {
    vi.spyOn(axios, 'post').mockRejectedValue(new Error('refresh denied'));
    const error = { config: { headers: {} }, response: { status: 401 } };

    await dispatchRejectedResponse(error);

    expect(mocks.clearAuth).toHaveBeenCalledOnce();
    expect(fakeWindow.location.href).toBe('/login');
  });

  it('keeps Field 401s isolated from operator refresh and redirect', async () => {
    mocks.fieldAuthHeaders.mockReturnValue({
      'X-Field-Device': 'device-credential',
      'X-Field-Token': 'shift-credential',
    });
    const post = vi.spyOn(axios, 'post').mockRejectedValue(new Error('must not refresh a Field session'));
    const error = {
      config: { headers: { 'X-Field-Token': 'shift-credential' } },
      response: { status: 401 },
    };

    await dispatchRejectedResponse(error);

    expect(mocks.announceFieldSessionExpired).toHaveBeenCalledOnce();
    expect(post).not.toHaveBeenCalled();
    expect(mocks.clearAuth).not.toHaveBeenCalled();
    expect(fakeWindow.location.href).toBe('/cds/analytics');
  });
});
