import { Centrifuge, type Subscription, type PublicationContext } from 'centrifuge';
import { api } from './api.js';

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

async function fetchConnectionToken(): Promise<string> {
  const { data } = await api.post<{ token: string }>('/realtime/token');
  return data.token;
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
    const sub = c.newSubscription(channel, { recoverable: true });
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
