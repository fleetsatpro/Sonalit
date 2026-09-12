import { Centrifuge } from 'centrifuge';
import api from './api';

// The backend fully migrated its realtime layer to Centrifugo; the
// socket.io-client this app used to import had no server to connect to
// (backend/src has zero Socket.IO server code), so every "live" event
// (position updates, panic/SOS, alerts, geofence events) silently never
// fired. This client replaces that dead transport with the same one
// apps/web already uses successfully.

let client = null;

// One Subscription per channel, fanned out to every registered handler —
// mirrors apps/web's lib/centrifuge.ts so multiple components can share a
// single org-channel subscription without Centrifuge's "already exists" error.
const channelSubs = new Map();

async function fetchConnectionToken() {
  const { data } = await api.post('/realtime/token');
  return data.token;
}

export function getCentrifuge() {
  if (!client) {
    client = new Centrifuge(import.meta.env.VITE_CENTRIFUGO_URL || 'wss://rt.sonalit.io/connection/websocket', {
      getToken: fetchConnectionToken,
    });
    client.connect();
  }
  return client;
}

export function disconnectCentrifuge() {
  if (client) {
    client.disconnect();
    client = null;
    channelSubs.clear();
  }
}

export function subscribe(channel, handler) {
  const c = getCentrifuge();
  let entry = channelSubs.get(channel);
  if (!entry) {
    const handlers = new Set();
    const sub = c.newSubscription(channel, { recoverable: true });
    sub.on('publication', (ctx) => {
      for (const h of handlers) h(ctx.data);
    });
    sub.subscribe();
    entry = { sub, handlers };
    channelSubs.set(channel, entry);
  }
  entry.handlers.add(handler);
  return () => {
    const e = channelSubs.get(channel);
    if (!e || !e.handlers.delete(handler) || e.handlers.size > 0) return;
    channelSubs.delete(channel);
    e.sub.unsubscribe();
    e.sub.removeAllListeners();
    client?.removeSubscription(e.sub);
  };
}
