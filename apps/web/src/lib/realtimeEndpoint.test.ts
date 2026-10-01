import { describe, expect, test } from 'vitest';

import { resolveRealtimeWsUrl } from './realtimeEndpoint';

describe('resolveRealtimeWsUrl', () => {
  test('uses the live Railway Centrifugo endpoint by default', () => {
    expect(resolveRealtimeWsUrl()).toBe('wss://centrifugo-production-c103.up.railway.app/connection/websocket');
  });

  test('rejects the unresolved legacy rt hostname', () => {
    expect(resolveRealtimeWsUrl('wss://rt.sonalit.io/connection/websocket'))
      .toBe('wss://centrifugo-production-c103.up.railway.app/connection/websocket');
  });

  test('rejects the stale Guardian hostname', () => {
    expect(resolveRealtimeWsUrl('wss://centrifugo.sonalit.io/connection/websocket'))
      .toBe('wss://centrifugo-production-c103.up.railway.app/connection/websocket');
  });

  test('preserves an explicitly configured non-legacy endpoint', () => {
    expect(resolveRealtimeWsUrl('wss://realtime.example.test/connection/websocket'))
      .toBe('wss://realtime.example.test/connection/websocket');
  });

  test('fails closed on malformed values', () => {
    expect(resolveRealtimeWsUrl('not-a-url'))
      .toBe('wss://centrifugo-production-c103.up.railway.app/connection/websocket');
  });
});
