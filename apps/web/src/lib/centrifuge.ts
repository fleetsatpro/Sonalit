import axios from 'axios';
import { Centrifuge, type Subscription, type PublicationContext } from 'centrifuge';

import { api } from './api.js';
import { fieldAuthHeaders } from './fieldSession.js';

let client: Centrifuge | null = null;

// Centrifuge allows only ONE Subscription object per channel per client —
// newSubscription() throws "Subscription to the channel X already exists"
// on a duplicate. Several components legitimately listen to the same org
// channel at once (GlobalPanicAlarm lives in AppShell for the whole session
// while pages like Guardian, Convoys, Alerts, GPS subscribe on mount), so
// subscribe() multiplexes: one real Subscription per channel, fanned out to
// every registered handler, torn down when the last handler unsubscribes.
type AnyHandler = (data: unknown) => void;
const channelSubs = new Map<string, { sub: Subscription; handlers: Set<AnyHandler> }>();

async function realtimePost(path: string, body: Record<string, unknown> = {}): Promise<string> {
  const field = fieldAuthHeaders();
  if (Object.keys(field).length > 0) {
    const { data } = await axios.post<{ token: string }>(
      `${import.meta.env['VITE_API_BASE_URL'] ?? '/api/v1'}/realtime${path}`,
      body,
      { headers: field, withCredentials: false },
    );
    return data.token;
  }
  const { data } = await api.post<{ token: string }>(`/realtime${path}`, body);
  return data.token;
}

async function fetchConnectionToken(): Promise<string> {
  return realtimePost('/token');
}

async function fetchSubscriptionToken(channel: string): Promise<string> {
  return realtimePost('/subscription-token', { channel });
}

export function getCentrifuge(): Centrifuge {
  if (!client) {
    client = new Centrifuge(import.meta.env['VITE_CENTRIFUGO_URL'] ?? 'wss://rt.sonalit.io/connection/websocket', {
      getToken: fetchConnectionToken,
    });
    client.connect();
  }
  return client;
}

export function disconnectCentrifuge(): void {
  if (client) {
    client.disconnect();
    client = null;
    channelSubs.clear();
  }
}

export function subscribe<T>(channel: string, handler: (data: T) => void): () => void {
  const c = getCentrifuge();
  let entry = channelSubs.get(channel);
  if (!entry) {
    const handlers = new Set<AnyHandler>();
    const sub = c.newSubscription(channel, {
      recoverable: true,
      getToken: () => fetchSubscriptionToken(channel),
    });
    sub.on('publication', (ctx: PublicationContext) => {
      for (const h of handlers) h(ctx.data);
    });
    sub.subscribe();
    entry = { sub, handlers };
    channelSubs.set(channel, entry);
  }
  const h = handler as AnyHandler;
  entry.handlers.add(h);
  return () => {
    const e = channelSubs.get(channel);
    if (!e || !e.handlers.delete(h) || e.handlers.size > 0) return;
    channelSubs.delete(channel);
    e.sub.unsubscribe();
    e.sub.removeAllListeners();
    client?.removeSubscription(e.sub);
  };
}
