import { Centrifuge } from 'centrifuge';
import { api } from './api.js';
let client = null;
async function fetchConnectionToken() {
    const { data } = await api.post('/realtime/token');
    return data.token;
}
export function getCentrifuge() {
    if (!client) {
        client = new Centrifuge(import.meta.env['VITE_CENTRIFUGO_URL'] ?? 'wss://rt.sonalit.io/connection/websocket', {
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
    }
}
export function subscribe(channel, handler) {
    const c = getCentrifuge();
    const sub = c.newSubscription(channel, { recoverable: true });
    sub.on('publication', (ctx) => handler(ctx.data));
    sub.subscribe();
    return () => { sub.unsubscribe(); sub.removeAllListeners(); c.removeSubscription(sub); };
}
