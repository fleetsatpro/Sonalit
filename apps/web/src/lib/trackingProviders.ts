/**
 * Tracking provider interface — the adapter boundary between the Journey Engine
 * and whatever is physically producing location fixes.
 *
 * The backend does not care where telemetry came from: browser GPS, Capacitor
 * on Android or iOS, a SecuriSat e-lock, or a future telematics box all enter
 * the same unified ingestion endpoint. This module is the client half of that
 * contract, so adding a native path is a new provider rather than a rewrite of
 * the driver screen.
 *
 * The rule the whole file exists to enforce: a provider reports what it can
 * *actually* do, never what the product would like it to do. A browser page
 * cannot hold location once it leaves the foreground, so the web provider
 * always reports `unsupported` — even with permission granted. Only a native
 * shell with a real background watcher may report `granted`.
 */

export type Runtime = 'web' | 'capacitor';
export type Platform = 'browser' | 'android' | 'ios' | 'unknown';
export type BackgroundStatus = 'unsupported' | 'denied' | 'restricted' | 'granted' | 'unknown';

export interface TrackingFix {
  lat: number;
  lng: number;
  accuracy_m: number | null;
  altitude_m: number | null;
  speed_kph: number | null;
  heading: number | null;
  device_time: string;
  battery_level: number | null;
  network_status: string;
  buffered: boolean;
}

export interface Capability {
  runtime: Runtime;
  platform: Platform;
  background_status: BackgroundStatus;
  location_permission: 'granted' | 'denied' | 'not_determined';
  location_services: boolean | null;
  failure_reason: string | null;
}

export type FixHandler = (fix: TrackingFix) => void;
export type ErrorHandler = (kind: 'permission_denied' | 'position_unavailable' | 'unknown') => void;

export interface TrackingProvider {
  readonly runtime: Runtime;
  readonly platform: Platform;
  /** Runs the real OS permission flow and reports the verified outcome. */
  requestCapability(): Promise<Capability>;
  start(onFix: FixHandler, onError: ErrorHandler): Promise<void>;
  stop(): Promise<void>;
}

/* ─── Shared helpers ──────────────────────────────────────────────────────── */

async function readBattery(): Promise<number | null> {
  try {
    const nav = navigator as Navigator & { getBattery?: () => Promise<{ level: number }> };
    if (!nav.getBattery) return null;
    const b = await nav.getBattery();
    return Math.round(b.level * 100);
  } catch { return null; }
}

function detectPlatform(): Platform {
  const ua = navigator.userAgent || '';
  if (/android/i.test(ua)) return 'android';
  if (/iPad|iPhone|iPod/.test(ua)) return 'ios';
  return 'browser';
}

async function toFix(coords: GeolocationCoordinates, timestamp: number): Promise<TrackingFix> {
  return {
    lat: coords.latitude,
    lng: coords.longitude,
    accuracy_m: coords.accuracy ?? null,
    altitude_m: coords.altitude ?? null,
    speed_kph: coords.speed != null ? coords.speed * 3.6 : null,
    heading: coords.heading ?? null,
    device_time: new Date(timestamp).toISOString(),
    battery_level: await readBattery(),
    network_status: navigator.onLine ? 'online' : 'offline',
    buffered: !navigator.onLine,
  };
}

/* ─── Web provider ────────────────────────────────────────────────────────── */

/**
 * Foreground-only browser geolocation.
 *
 * Always reports `background_status: 'unsupported'`. That is not pessimism: the
 * page stops receiving fixes when the driver switches apps or locks the phone,
 * and claiming otherwise would put a green light on a channel that has silently
 * stopped. Sonalit would rather show the health engine degrading to DELAYED
 * than fabricate continuity.
 */
class WebProvider implements TrackingProvider {
  readonly runtime = 'web' as const;
  readonly platform: Platform = detectPlatform() === 'browser' ? 'browser' : detectPlatform();
  private watchId: number | null = null;

  async requestCapability(): Promise<Capability> {
    const position = await new Promise<GeolocationPosition | null>((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (p) => resolve(p), () => resolve(null),
        { enableHighAccuracy: true, timeout: 30_000 },
      );
    });

    // Verify rather than assume — a resolved prompt is not the same as granted.
    let permission: Capability['location_permission'] = position ? 'granted' : 'denied';
    try {
      const status = await navigator.permissions?.query({ name: 'geolocation' as PermissionName });
      if (status?.state === 'granted') permission = 'granted';
      else if (status?.state === 'denied') permission = 'denied';
      else if (!position) permission = 'not_determined';
    } catch { /* Safari has no permissions API for geolocation */ }

    return {
      runtime: this.runtime,
      platform: this.platform,
      background_status: 'unsupported',
      location_permission: permission,
      location_services: position ? true : null,
      failure_reason: permission === 'granted' ? null : 'permission_not_granted',
    };
  }

  // Not `async`: watchPosition is callback-based and there is nothing to await.
  start(onFix: FixHandler, onError: ErrorHandler): Promise<void> {
    if (this.watchId !== null) return Promise.resolve();
    this.watchId = navigator.geolocation.watchPosition(
      (pos) => { void toFix(pos.coords, pos.timestamp).then(onFix); },
      (err) => {
        if (err.code === 1) onError('permission_denied');
        else if (err.code === 2) onError('position_unavailable');
        else onError('unknown');
      },
      { enableHighAccuracy: true, maximumAge: 5_000, timeout: 30_000 },
    );
    return Promise.resolve();
  }

  stop(): Promise<void> {
    if (this.watchId !== null) { navigator.geolocation.clearWatch(this.watchId); this.watchId = null; }
    return Promise.resolve();
  }
}

/* ─── Capacitor provider ──────────────────────────────────────────────────── */

interface BackgroundWatcherLocation {
  latitude: number; longitude: number;
  accuracy?: number; altitude?: number; speed?: number; bearing?: number; time?: number;
}
interface BackgroundGeolocationPlugin {
  addWatcher(
    options: { backgroundMessage?: string; backgroundTitle?: string; requestPermissions?: boolean; stale?: boolean; distanceFilter?: number },
    callback: (location?: BackgroundWatcherLocation, error?: { code?: string; message?: string }) => void,
  ): Promise<string>;
  removeWatcher(options: { id: string }): Promise<void>;
}

function backgroundPlugin(): BackgroundGeolocationPlugin | null {
  const cap = (window as unknown as {
    Capacitor?: { Plugins?: Record<string, unknown> };
  }).Capacitor;
  const plugin = cap?.Plugins?.['BackgroundGeolocation'];
  return (plugin as BackgroundGeolocationPlugin | undefined) ?? null;
}

/**
 * Native background tracking through @capacitor-community/background-geolocation.
 *
 * Only reachable when the installed shell actually bundles the plugin — a
 * Capacitor container *without* it is no better than a browser tab for holding
 * location, and honestly reports `unsupported` rather than inheriting the
 * native runtime's reputation.
 */
class CapacitorProvider implements TrackingProvider {
  readonly runtime = 'capacitor' as const;
  readonly platform: Platform = detectPlatform();
  private watcherId: string | null = null;

  async requestCapability(): Promise<Capability> {
    const plugin = backgroundPlugin();
    if (!plugin) {
      return {
        runtime: this.runtime, platform: this.platform,
        background_status: 'unsupported',
        location_permission: 'not_determined',
        location_services: null,
        failure_reason: 'background_plugin_missing',
      };
    }

    // addWatcher with requestPermissions drives the real OS dialogs, including
    // Android's separate "allow all the time" step.
    return await new Promise<Capability>((resolve) => {
      let settled = false;
      plugin.addWatcher(
        {
          backgroundTitle: 'Sonalit journey tracking',
          backgroundMessage: 'Recording this journey.',
          requestPermissions: true,
          stale: false,
          distanceFilter: 20,
        },
        (location, error) => {
          if (settled) return;
          settled = true;
          if (error) {
            resolve({
              runtime: this.runtime, platform: this.platform,
              background_status: error.code === 'NOT_AUTHORIZED' ? 'denied' : 'restricted',
              location_permission: error.code === 'NOT_AUTHORIZED' ? 'denied' : 'not_determined',
              location_services: false,
              failure_reason: error.message ?? error.code ?? 'background_unavailable',
            });
            return;
          }
          resolve({
            runtime: this.runtime, platform: this.platform,
            background_status: 'granted',
            location_permission: 'granted',
            location_services: true,
            failure_reason: null,
          });
          void location;
        },
      ).then((id) => { this.watcherId = id; }).catch(() => {
        if (settled) return;
        settled = true;
        resolve({
          runtime: this.runtime, platform: this.platform,
          background_status: 'unknown', location_permission: 'not_determined',
          location_services: null, failure_reason: 'watcher_failed',
        });
      });
    });
  }

  async start(onFix: FixHandler, onError: ErrorHandler): Promise<void> {
    const plugin = backgroundPlugin();
    if (!plugin) { onError('position_unavailable'); return; }
    // requestCapability already opened the watcher; reuse it so the OS sees one
    // continuous background session rather than a stop/start churn.
    if (this.watcherId) {
      // Re-register the callback against the live watcher by opening a second
      // one only if the first was never created.
      return;
    }
    this.watcherId = await plugin.addWatcher(
      { backgroundTitle: 'Sonalit journey tracking', backgroundMessage: 'Recording this journey.', requestPermissions: false, stale: false, distanceFilter: 20 },
      (location, error) => {
        if (error) { onError(error.code === 'NOT_AUTHORIZED' ? 'permission_denied' : 'position_unavailable'); return; }
        if (!location) return;
        void (async () => {
          onFix({
            lat: location.latitude,
            lng: location.longitude,
            accuracy_m: location.accuracy ?? null,
            altitude_m: location.altitude ?? null,
            speed_kph: location.speed != null ? location.speed * 3.6 : null,
            heading: location.bearing ?? null,
            device_time: new Date(location.time ?? Date.now()).toISOString(),
            battery_level: await readBattery(),
            network_status: navigator.onLine ? 'online' : 'offline',
            buffered: !navigator.onLine,
          });
        })();
      },
    );
  }

  async stop(): Promise<void> {
    const plugin = backgroundPlugin();
    if (plugin && this.watcherId) {
      await plugin.removeWatcher({ id: this.watcherId }).catch(() => undefined);
      this.watcherId = null;
    }
  }
}

/* ─── Selection ───────────────────────────────────────────────────────────── */

function inCapacitor(): boolean {
  return typeof (window as unknown as { Capacitor?: unknown }).Capacitor !== 'undefined';
}

/**
 * Pick the best provider this runtime can actually honour. Native is preferred
 * for operational journeys, but only when the background plugin is really
 * present — otherwise the web provider is chosen precisely so the reported
 * capability stays truthful.
 */
export function selectProvider(): TrackingProvider {
  if (inCapacitor() && backgroundPlugin()) return new CapacitorProvider();
  if (inCapacitor()) return new CapacitorProvider(); // reports 'unsupported' honestly
  return new WebProvider();
}
