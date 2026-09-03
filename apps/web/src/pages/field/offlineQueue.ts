/**
 * Durable offline queue for Yard/Port field actions.
 *
 * A yard or a port apron is exactly where connectivity dies — steel boxes,
 * container stacks, patchy LTE — and it is also where the work happens. Before
 * this, a clamp submitted in a dead zone simply failed and the worker had to
 * remember to redo it later, or the custody record silently never happened.
 *
 * Each queued action carries a UUID that doubles as its `x-idempotency-key`.
 * That is what makes retrying safe: a clamp creates a trip and upserts a
 * driver/vehicle/e-lock, so without a stable key, a submission that actually
 * reached the server but whose *response* was lost would create a second trip
 * on retry. The key is minted once at enqueue time and reused for every
 * attempt, so the server collapses duplicates for us.
 *
 * Persistence is localStorage: the payloads are a few hundred bytes, and the
 * queue has to survive the OS killing the WebView mid-shift, which in-memory
 * state would not. Note this is operational data (container, truck, driver
 * name) already visible on screen — never credentials. The access token stays
 * in memory only, per the T1.2 policy in stores/auth.ts.
 */
import cdsApi from '../cds/api.js';
import { isReachable, startConnectivity, subscribe as subscribeConnectivity } from '../../lib/offline/connectivity.js';

import type { AxiosError } from 'axios';


const STORAGE_KEY = 'sonalit-field-queue-v1';

export type FieldActionKind = 'clamp' | 'unclamp';

export interface QueuedAction {
  /** Doubles as the idempotency key sent to the server. */
  id: string;
  kind: FieldActionKind;
  bookingId: string;
  containerId: string;
  /** Container number (or a fallback), purely so the UI can name the action. */
  label: string;
  payload: Record<string, unknown>;
  queuedAt: number;
  attempts: number;
}

export interface FailedAction extends QueuedAction {
  /** Human-readable reason, surfaced to the worker so the effort isn't lost silently. */
  reason: string;
  failedAt: number;
}

interface QueueState {
  pending: QueuedAction[];
  failed: FailedAction[];
}

type Listener = (state: QueueSnapshot) => void;

export interface QueueSnapshot extends QueueState {
  online: boolean;
  syncing: boolean;
}

const state: QueueState = load();
let syncing = false;
const listeners = new Set<Listener>();

function load(): QueueState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { pending: [], failed: [] };
    const parsed = JSON.parse(raw) as Partial<QueueState>;
    return {
      pending: Array.isArray(parsed.pending) ? parsed.pending : [],
      failed: Array.isArray(parsed.failed) ? parsed.failed : [],
    };
  } catch {
    // A corrupt blob must not brick the app on boot — the worker can redo the
    // action, but they can't use a screen that throws on mount.
    return { pending: [], failed: [] };
  }
}

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Quota/private-mode failures are not worth breaking the flow over; the
    // queue still works for this session, it just won't survive a restart.
  }
}

/**
 * Delegated to the connectivity manager rather than reading navigator.onLine
 * directly. That flag reports whether an interface is up, not whether Sonalit
 * is answering — a captive portal or a cell that associates but routes nothing
 * both report online while every clamp fails, which is the case this queue
 * exists for. The manager decides from real request outcomes instead.
 */
export function isOnline(): boolean {
  return isReachable();
}

export function getSnapshot(): QueueSnapshot {
  return { pending: state.pending, failed: state.failed, online: isOnline(), syncing };
}

function emit(): void {
  const snap = getSnapshot();
  for (const l of listeners) l(snap);
}

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

function newId(): string {
  // crypto.randomUUID needs a secure context; the field app is served over
  // HTTPS so it's there in practice, but a plain-http dev host would not have
  // it and losing the queue to a ReferenceError isn't worth the elegance.
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `q-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function enqueue(
  action: Omit<QueuedAction, 'id' | 'queuedAt' | 'attempts'>,
): QueuedAction {
  const entry: QueuedAction = { ...action, id: newId(), queuedAt: Date.now(), attempts: 0 };
  state.pending = [...state.pending, entry];
  persist();
  emit();
  // Opportunistic: if this was queued because a single request failed rather
  // than because the device is offline, the next flush may well succeed.
  void flush();
  return entry;
}

export function dismissFailed(id: string): void {
  state.failed = state.failed.filter(f => f.id !== id);
  persist();
  emit();
}

export function clearFailed(): void {
  state.failed = [];
  persist();
  emit();
}

function urlFor(a: QueuedAction): string {
  return `/bookings/${a.bookingId}/containers/${a.containerId}/${a.kind}`;
}

/**
 * Whether a failed attempt is worth retrying later.
 *
 * Retryable: no response at all (offline//timeout), 401 (token expired — the
 * refresh interceptor will renew it), 408/429 (transient), any 5xx.
 * Permanent: the rest of 4xx — a 409 "already delivered" or a 404 will fail
 * identically forever, so retrying just burns battery.
 */
function isRetryable(err: AxiosError): boolean {
  const status = err.response?.status;
  if (status == null) return true;
  if (status === 401 || status === 408 || status === 429) return true;
  return status >= 500;
}

function describe(err: AxiosError): string {
  const data = err.response?.data as { error?: string; message?: string } | undefined;
  return data?.message ?? data?.error ?? err.message ?? 'Unknown error';
}

/**
 * Drain the queue oldest-first, stopping at the first retryable failure.
 *
 * Order matters and the stop is deliberate: actions on the same container are
 * causally ordered (a clamp must land before its unclamp), so skipping past a
 * stuck entry could apply them out of sequence.
 */
export async function flush(): Promise<void> {
  if (syncing || !isOnline() || state.pending.length === 0) return;

  syncing = true;
  emit();

  try {
    while (state.pending.length > 0) {
      const entry = state.pending[0];
      if (!entry) break;

      try {
        await cdsApi.post(urlFor(entry), entry.payload, {
          headers: { 'x-idempotency-key': entry.id },
        });
        state.pending = state.pending.slice(1);
        persist();
        emit();
      } catch (err) {
        const axiosErr = err as AxiosError;
        if (isRetryable(axiosErr)) {
          entry.attempts += 1;
          persist();
          emit();
          break;
        }
        // Permanent: surface it instead of silently discarding work the
        // worker believes they completed.
        state.pending = state.pending.slice(1);
        state.failed = [
          ...state.failed,
          { ...entry, reason: describe(axiosErr), failedAt: Date.now() },
        ];
        persist();
        emit();
      }
    }
  } finally {
    syncing = false;
    emit();
  }
}

let started = false;

/**
 * Wire up the triggers that drain the queue. Idempotent — the field screens
 * all call it on mount and only the first call takes effect.
 */
export function startOfflineQueue(): void {
  if (started || typeof window === 'undefined') return;
  started = true;

  // The manager owns the OS events, the probe schedule and the hysteresis; this
  // queue just reacts to its verdict. Previously both this file and half a
  // dozen others each interpreted navigator.onLine their own way, and they did
  // not agree with each other.
  startConnectivity();
  subscribeConnectivity(() => {
    emit();
    if (isReachable()) void flush();
  });

  // A slow poll remains as the backstop: a state that never changes emits no
  // event, and a queue that only drains on transitions can sit full on a link
  // that has been quietly fine the whole time. It no-ops when there is nothing
  // to send.
  window.setInterval(() => { void flush(); }, 30_000);

  void flush();
}
