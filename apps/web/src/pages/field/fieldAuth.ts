/**
 * Field app authentication — device pairing + per-worker PIN.
 *
 * The operator app's client (lib/api.ts) is not reused here on purpose. That
 * one sends cookies, injects the CSRF double-submit header, and bounces to
 * /login when a refresh fails; all three are wrong for a shared yard tablet,
 * and two of them would reach across into the operator session. This client
 * sends `withCredentials: false` and nothing but the two Field headers, so a
 * request from this app is answered purely on Field credentials even if an
 * operator cookie happens to be sitting in the same jar.
 *
 * See lib/fieldSession.ts for where the two tokens live and why they live in
 * different places, and backend/src/routes/field.js for the other end.
 */
import axios from 'axios';
import { create } from 'zustand';

import {
  FIELD_SESSION_EXPIRED_EVENT, getFieldDeviceToken, getFieldSessionToken,
  setFieldDeviceToken, setFieldSessionToken,
} from '../../lib/fieldSession.js';

import type { AxiosError } from 'axios';

const API_BASE = import.meta.env['VITE_API_BASE_URL'] ?? '/api/v1';

export const fieldApi = axios.create({
  baseURL: `${API_BASE}/field`,
  timeout: 15_000,
  withCredentials: false,
});

fieldApi.interceptors.request.use((config) => {
  const device = getFieldDeviceToken();
  if (device) config.headers['X-Field-Device'] = device;
  const session = getFieldSessionToken();
  if (session) config.headers['X-Field-Token'] = session;
  return config;
});

export interface FieldDevice {
  id: string;
  label: string;
  site: string | null;
  scope: 'yard' | 'port' | 'response' | null;
}

export interface FieldWorker {
  id: string;
  name: string;
  role: 'yard_agent' | 'port_agent' | 'response_crew';
  org_id?: string;
}

export interface RosterEntry {
  id: string;
  name: string;
  role: 'yard_agent' | 'port_agent' | 'response_crew';
  has_pin: boolean;
  locked: boolean;
}

/**
 * `booting` exists so the sign-in screen doesn't flash before the stored
 * device/session tokens have been checked against the server — on a tablet
 * that reloads into the middle of a shift, that flash reads as "you've been
 * logged out" and sends crews hunting for a supervisor.
 */
type Phase = 'booting' | 'unpaired' | 'locked' | 'ready';

interface FieldAuthState {
  phase: Phase;
  device: FieldDevice | null;
  worker: FieldWorker | null;
  mustChangePin: boolean;
  boot: () => Promise<void>;
  pair: (code: string) => Promise<void>;
  signIn: (userId: string, pin: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** Called by the shared CDS client when the server rejects the session. */
  sessionExpired: () => void;
  unpair: () => void;
}

export function fieldError(err: unknown, fallback: string): string {
  const e = err as AxiosError<{ error?: string; message?: string }>;
  return e.response?.data?.message ?? e.response?.data?.error ?? fallback;
}

export const useFieldAuth = create<FieldAuthState>()((set, get) => ({
  phase: 'booting',
  device: null,
  worker: null,
  mustChangePin: false,

  /**
   * Resolve where the app should start: pairing screen, PIN screen, or straight
   * into work. Both tokens are validated against the server rather than trusted
   * from storage, which is what makes a revoked tablet fall back to pairing
   * instead of failing later with an unexplained error on a clamp.
   */
  boot: async () => {
    if (!getFieldDeviceToken()) {
      set({ phase: 'unpaired', device: null, worker: null });
      return;
    }
    try {
      const { data } = await fieldApi.get<{ data: FieldDevice }>('/app/device');
      set({ device: data.data });
    } catch (err) {
      const status = (err as AxiosError).response?.status;
      // Only a rejected credential means unpaired. A network failure must not
      // wipe a working tablet's pairing — that is the offline case, and the
      // device token is still perfectly good.
      if (status === 401 || status === 403) {
        setFieldDeviceToken(null);
        setFieldSessionToken(null);
        set({ phase: 'unpaired', device: null, worker: null });
        return;
      }
      set({ phase: getFieldSessionToken() ? 'ready' : 'locked' });
      return;
    }

    if (!getFieldSessionToken()) {
      set({ phase: 'locked', worker: null });
      return;
    }
    try {
      const { data } = await fieldApi.get<{ data: { user: FieldWorker; device: FieldDevice } }>('/app/me');
      set({ phase: 'ready', worker: data.data.user, device: data.data.device });
    } catch (err) {
      const status = (err as AxiosError).response?.status;
      if (status === 401 || status === 403) {
        setFieldSessionToken(null);
        set({ phase: 'locked', worker: null });
      } else {
        // Offline with a session token in hand: let the worker keep working
        // off the cache and let the offline queue retry.
        set({ phase: 'ready' });
      }
    }
  },

  pair: async (code: string) => {
    const { data } = await axios.post<{ data: { device_token: string; device: FieldDevice } }>(
      `${API_BASE}/field/app/pair`, { code }, { withCredentials: false },
    );
    setFieldDeviceToken(data.data.device_token);
    setFieldSessionToken(null);
    set({ phase: 'locked', device: data.data.device, worker: null });
  },

  signIn: async (userId: string, pin: string) => {
    const { data } = await fieldApi.post<{
      data: { token: string; must_change_pin: boolean; user: FieldWorker; device: FieldDevice };
    }>('/app/sign-in', { user_id: userId, pin });
    setFieldSessionToken(data.data.token);
    set({
      phase: 'ready',
      worker: data.data.user,
      device: data.data.device,
      mustChangePin: data.data.must_change_pin,
    });
  },

  signOut: async () => {
    try {
      await fieldApi.post('/app/sign-out');
    } catch {
      // A tablet handed over in a dead zone still has to lock locally; the
      // server-side session expires on its own within the shift.
    }
    setFieldSessionToken(null);
    set({ phase: 'locked', worker: null, mustChangePin: false });
  },

  sessionExpired: () => {
    setFieldSessionToken(null);
    if (get().phase !== 'unpaired') set({ phase: 'locked', worker: null });
  },

  unpair: () => {
    setFieldDeviceToken(null);
    setFieldSessionToken(null);
    set({ phase: 'unpaired', device: null, worker: null });
  },
}));

export function fetchRoster(): Promise<RosterEntry[]> {
  return fieldApi.get<{ data: RosterEntry[] }>('/app/workers').then(r => r.data.data);
}

export function changeOwnPin(currentPin: string, newPin: string): Promise<void> {
  return fieldApi.post('/app/pin', { current_pin: currentPin, new_pin: newPin }).then(() => undefined);
}

// The shared CDS client (pages/cds/api.ts) also serves the operator dashboard,
// so it must not import this module. It announces a rejected field session on
// the window instead and we pick it up here — one-way, no coupling in the
// direction that would drag the field app into every dashboard bundle.
if (typeof window !== 'undefined') {
  window.addEventListener(FIELD_SESSION_EXPIRED_EVENT, () => {
    useFieldAuth.getState().sessionExpired();
  });
}
