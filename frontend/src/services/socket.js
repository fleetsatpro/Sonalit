import { io } from 'socket.io-client';

let socket = null;

function connect() {
  if (socket?.connected) return socket;
  if (socket) { socket.disconnect(); socket = null; }

  const token = localStorage.getItem('token');
  if (!token) { console.warn('[Socket] No token — not connecting'); return null; }

  socket = io(import.meta.env.VITE_SOCKET_URL || window.location.origin, {
    auth: { token },
    transports: ['websocket', 'polling'],
    reconnectionAttempts: 5,
    reconnectionDelayMax: 5000,
    timeout: 10000,
  });

  socket.on('connect', () => console.info('[Socket] Connected:', socket.id));
  socket.on('disconnect', (reason) => console.warn('[Socket] Disconnected:', reason));
  socket.on('connect_error', (err) => console.error('[Socket] Error:', err.message));

  return socket;
}

function disconnect() {
  if (socket) { socket.disconnect(); socket = null; }
}

function isConnected() { return socket?.connected === true; }

function guard(fn, name) {
  if (!socket) { console.warn(`[Socket] Cannot ${name} — socket not initialised`); return; }
  fn(socket);
}

// ── Typed subscriptions ───────────────────────────────────────────────
const on = (event, cb) => guard((s) => s.on(event, cb), `on(${event})`);
const off = (event, cb) => guard((s) => s.off(event, cb), `off(${event})`);
const emit = (event, data) => guard((s) => s.emit(event, data), `emit(${event})`);

const subscribeRegion = (region) => emit('subscribe:region', region);
const onVehicleUpdate = (cb) => on('vehicle:update', cb);
const onConvoyUpdate = (cb) => on('convoy:update', cb);
const onAlertNew = (cb) => on('alert:new', cb);
const onMessageNew = (cb) => on('message:new', cb);
const onIncidentNew = (cb) => on('incident:new', cb);

export default { connect, disconnect, isConnected, on, off, emit, subscribeRegion, onVehicleUpdate, onConvoyUpdate, onAlertNew, onMessageNew, onIncidentNew };
