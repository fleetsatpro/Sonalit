import { io } from 'socket.io-client';

let socket = null;

function connect() {
  if (socket?.connected) return socket;
  if (socket) { socket.disconnect(); socket = null; }

  const token = localStorage.getItem('token');
  if (!token) { console.warn('[Socket] No token'); return null; }

  socket = io(import.meta.env.VITE_SOCKET_URL || window.location.origin, {
    auth: { token },
    transports: ['websocket', 'polling'],
    reconnectionAttempts: 10,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    timeout: 10000,
  });

  socket.on('connect',       () => console.info('[Socket] Connected:', socket.id));
  socket.on('disconnect',    (r) => console.warn('[Socket] Disconnected:', r));
  socket.on('connect_error', (e) => console.error('[Socket] Error:', e.message));

  return socket;
}

function disconnect() { if (socket) { socket.disconnect(); socket = null; } }
function isConnected() { return socket?.connected === true; }

const off = (ev, cb) => { if (socket) socket.off(ev, cb); };
const on  = (ev, cb) => {
  if (socket) socket.on(ev, cb);
  return () => off(ev, cb);
};
const emit = (ev, d)  => { if (socket) socket.emit(ev, d); };

// Typed subscriptions
const subscribeRegion    = (r)  => emit('subscribe:region', r);
const onVehicleUpdate    = (cb) => on('vehicle:update', cb);
const onConvoyUpdate     = (cb) => on('convoy:update', cb);
const onConvoyDeviation  = (cb) => on('convoy:deviation', cb);
const onConvoyETA        = (cb) => on('convoy:eta', cb);
const onAlertNew         = (cb) => on('alert:new', cb);
const onAlert            = (cb) => on('alert:new', cb);   // alias
const onMessageNew       = (cb) => on('message:new', cb);
const onIncidentNew      = (cb) => on('incident:new', cb);
const onDeviceLocation   = (cb) => on('device:location', cb);
const onDevicePanic      = (cb) => on('device:panic', cb);
const onDeviceReport     = (cb) => on('device:report', cb);

export default {
  connect, disconnect, isConnected, on, off, emit,
  subscribeRegion,
  onVehicleUpdate, onConvoyUpdate, onConvoyDeviation, onConvoyETA,
  onAlertNew, onAlert,
  onMessageNew, onIncidentNew,
  onDeviceLocation, onDevicePanic, onDeviceReport,
};
