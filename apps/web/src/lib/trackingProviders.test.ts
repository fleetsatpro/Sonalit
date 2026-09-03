import { afterEach, describe, expect, it, vi } from 'vitest';

import { CapacitorProvider } from './trackingProviders.js';

import type { TrackingFix } from './trackingProviders.js';

/**
 * Regression cover for the native fix-dispatch path.
 *
 * The bug this guards against shipped once (PR #348) and was invisible from the
 * outside: the device reported `background_status: 'granted'`, the operator saw
 * an authorised session, and not one fix was ever delivered. Anything that can
 * silently sever the plugin callback from the fix handler belongs here.
 */

interface Cb { (l?: { latitude: number; longitude: number; time?: number }, e?: { code?: string }): void }

/** Fake plugin whose addWatcher promise resolution is controlled by the test. */
function fakePlugin(opts: { resolveDelayMs?: number } = {}) {
  const state = {
    callbacks: [] as Cb[],
    added: 0,
    removed: [] as string[],
  };
  const plugin = {
    addWatcher(_o: unknown, cb: Cb): Promise<string> {
      state.added += 1;
      state.callbacks.push(cb);
      const id = `watcher-${state.added}`;
      return new Promise((resolve) => setTimeout(() => resolve(id), opts.resolveDelayMs ?? 0));
    },
    removeWatcher({ id }: { id: string }): Promise<void> {
      state.removed.push(id);
      return Promise.resolve();
    },
  };
  (globalThis as unknown as { window: Record<string, unknown> }).window ??= globalThis as never;
  (window as unknown as { Capacitor?: unknown }).Capacitor = { Plugins: { BackgroundGeolocation: plugin } };
  return state;
}

/**
 * Settle requestCapability() the way a device does: the plugin's FIRST callback
 * is the verified permission outcome. Awaiting it without one hangs, correctly —
 * the provider refuses to guess a capability it has not observed.
 */
async function grantedCapability(provider: CapacitorProvider, state: ReturnType<typeof fakePlugin>) {
  const pending = provider.requestCapability();
  await vi.waitFor(() => expect(state.callbacks.length).toBeGreaterThan(0));
  state.callbacks[0]!({ latitude: -1.28, longitude: 36.81, time: Date.now() });
  return pending;
}

afterEach(() => {
  delete (window as unknown as { Capacitor?: unknown }).Capacitor;
  vi.useRealTimers();
});

describe('CapacitorProvider — fix dispatch', () => {
  it('delivers fixes to the handler start() installed', async () => {
    const state = fakePlugin();
    const provider = new CapacitorProvider();
    const fixes: TrackingFix[] = [];

    await grantedCapability(provider, state);
    await provider.start((f) => fixes.push(f), () => undefined);

    state.callbacks[0]!({ latitude: -1.29, longitude: 36.82, time: Date.now() });
    await vi.waitFor(() => expect(fixes).toHaveLength(1));
    expect(fixes[0]!.lat).toBeCloseTo(-1.29);
  });

  it('reuses the capability watcher instead of opening a second one', async () => {
    const state = fakePlugin();
    const provider = new CapacitorProvider();

    await grantedCapability(provider, state);
    await provider.start(() => undefined, () => undefined);

    // One OS background session for the whole journey.
    expect(state.added).toBe(1);
  });

  /**
   * The race the `watcherPending` promise exists to close.
   *
   * requestCapability() settles off the plugin's first CALLBACK, which arrives
   * on a different bridge path from the addWatcher PROMISE. With a slow promise
   * the id is still unassigned when start() runs — and a start() that tested
   * `watcherId` would open a second watcher, double-reporting telemetry and
   * orphaning a foreground service that stop() could never remove.
   */
  it('opens no second watcher when the addWatcher promise is slower than the first callback', async () => {
    const state = fakePlugin({ resolveDelayMs: 50 });
    const provider = new CapacitorProvider();

    const capability = provider.requestCapability();
    // First callback lands well before addWatcher resolves.
    await vi.waitFor(() => expect(state.callbacks).toHaveLength(1));
    state.callbacks[0]!({ latitude: -1.28, longitude: 36.81, time: Date.now() });
    await capability;

    await provider.start(() => undefined, () => undefined);
    expect(state.added).toBe(1);
  });

  it('stop() removes a watcher that was still being opened', async () => {
    const state = fakePlugin({ resolveDelayMs: 50 });
    const provider = new CapacitorProvider();

    const capability = provider.requestCapability();
    await vi.waitFor(() => expect(state.callbacks).toHaveLength(1));
    state.callbacks[0]!({ latitude: -1.28, longitude: 36.81, time: Date.now() });
    await capability;

    // No zombie background services: stopping mid-activation must still close it.
    await provider.stop();
    expect(state.removed).toEqual(['watcher-1']);
  });

  it('drops fixes after stop() — a late callback cannot resurrect a finished journey', async () => {
    const state = fakePlugin();
    const provider = new CapacitorProvider();
    const fixes: TrackingFix[] = [];

    await grantedCapability(provider, state);
    await provider.start((f) => fixes.push(f), () => undefined);
    await provider.stop();

    state.callbacks[0]!({ latitude: -1.28, longitude: 36.81, time: Date.now() });
    await new Promise((r) => setTimeout(r, 10));
    expect(fixes).toHaveLength(0);
  });

  it('reports unsupported when the shell has no background plugin', async () => {
    delete (window as unknown as { Capacitor?: unknown }).Capacitor;
    const cap = await new CapacitorProvider().requestCapability();
    expect(cap.background_status).toBe('unsupported');
    expect(cap.failure_reason).toBe('background_plugin_missing');
  });
});
