const PLANETARY_REALTIME_WS_URL = 'wss://centrifugo-production-c103.up.railway.app/connection/websocket';

const LEGACY_REALTIME_HOSTS = new Set([
  'rt.sonalit.io',
  'centrifugo.sonalit.io',
]);

export function resolveRealtimeWsUrl(raw?: string | null): string {
  const value = String(raw ?? '').trim();
  if (!value) return PLANETARY_REALTIME_WS_URL;

  try {
    const url = new URL(value);
    if (LEGACY_REALTIME_HOSTS.has(url.hostname.toLowerCase())) {
      return PLANETARY_REALTIME_WS_URL;
    }
    return value;
  } catch {
    return PLANETARY_REALTIME_WS_URL;
  }
}

export const CENTRIFUGO_WS_URL = resolveRealtimeWsUrl(
  import.meta.env['VITE_CENTRIFUGO_URL'] as string | undefined,
);
