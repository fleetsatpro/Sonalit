import axios from 'axios';
import toast from 'react-hot-toast';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api/v1',
  timeout: 15000,
});

// Attach JWT to every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Handle 401 globally
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('token');
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

// ── Auth ──────────────────────────────────────────────────────────────
export const authAPI = {
  login: (email, password) => api.post('/auth/login', { email, password }),
  me: () => api.get('/auth/me'),
  logout: () => api.post('/auth/logout'),
  changePassword: (data) => api.put('/auth/change-password', data),
};

// ── Vehicles ──────────────────────────────────────────────────────────
export const vehiclesAPI = {
  list: (params) => api.get('/vehicles', { params }),
  get: (id) => api.get(`/vehicles/${id}`),
  create: (data) => api.post('/vehicles', data),
  update: (id, data) => api.put(`/vehicles/${id}`, data),
  updateStatus: (id, status) => api.patch(`/vehicles/${id}/status`, { status }),
  delete: (id) => api.delete(`/vehicles/${id}`),
  history: (id) => api.get(`/vehicles/${id}/history`),
};

// ── Convoys ───────────────────────────────────────────────────────────
export const convoysAPI = {
  list: (params) => api.get('/convoys', { params }),
  get: (id) => api.get(`/convoys/${id}`),
  create: (data) => api.post('/convoys', data),
  update: (id, data) => api.put(`/convoys/${id}`, data),
  updateStatus: (id, status) => api.patch(`/convoys/${id}/status`, { status }),
  assign: (id, vehicleIds) => api.post(`/convoys/${id}/assign`, { vehicleIds }),
  delete: (id) => api.delete(`/convoys/${id}`),
  events: (id) => api.get(`/convoys/${id}/events`),
};

// ── Alerts ────────────────────────────────────────────────────────────
export const alertsAPI = {
  list: (params) => api.get('/alerts', { params }),
  get: (id) => api.get(`/alerts/${id}`),
  create: (data) => api.post('/alerts', data),
  acknowledge: (id) => api.patch(`/alerts/${id}/acknowledge`),
  resolve: (id) => api.patch(`/alerts/${id}/resolve`),
};

// ── Messages ──────────────────────────────────────────────────────────
export const messagesAPI = {
  channels: () => api.get('/messages/channels'),
  messages: (channelId, params) => api.get(`/messages/channels/${channelId}`, { params }),
  send: (channelId, content) => api.post(`/messages/channels/${channelId}`, { content }),
  broadcast: (content, severity) => api.post('/messages/broadcast', { content, severity }),
};

// ── Analytics ─────────────────────────────────────────────────────────
export const analyticsAPI = {
  dashboard: () => api.get('/analytics/dashboard'),
  fleetUtilization: () => api.get('/analytics/fleet-utilization'),
  convoyMetrics: () => api.get('/analytics/convoy-metrics'),
  incidentHeatmap: () => api.get('/analytics/incident-heatmap'),
};


export const gpsAPI = {
  list: (params) => api.get('/gps', { params }),
};

convoysAPI.getAll = (params) => api.get('/convoys', { params });
convoysAPI.updateStatus = (id, status) => api.patch('/convoys/' + id, { status });
vehiclesAPI.getAll = (params) => api.get('/vehicles', { params });
alertsAPI.getAll = (params) => api.get('/alerts', { params });
alertsAPI.acknowledge = (id) => api.patch('/alerts/' + id, { resolved: true });


export const geofenceAPI = {
  list: (p) => api.get('/geofences', { params: p }),
  create: (d) => api.post('/geofences', d),
  update: (id, d) => api.put('/geofences/'+id, d),
  delete: (id) => api.delete('/geofences/'+id),
};
export const deviceAPI = {
  list: (p) => api.get('/devices', { params: p }),
  create: (d) => api.post('/devices', d),
  update: (id, d) => api.put('/devices/'+id, d),
  health: (id) => api.get('/devices/'+id+'/health'),
};
export const incidentAPI = {
  list: (p) => api.get('/incidents', { params: p }),
  create: (d) => api.post('/incidents', d),
  update: (id, d) => api.patch('/incidents/'+id, d),
  addComment: (id, c) => api.post('/incidents/'+id+'/comments', { content: c }),
};
export const ruleAPI = {
  list: () => api.get('/rules'),
  create: (d) => api.post('/rules', d),
  toggle: (id, enabled) => api.patch('/rules/'+id, { enabled }),
  delete: (id) => api.delete('/rules/'+id),
};
export const reportAPI = {
  generate: (type, params) => api.post('/reports/generate', { type, ...params }),
  list: () => api.get('/reports'),
  download: (id) => api.get('/reports/'+id+'/download', { responseType: 'blob' }),
};
export const tripAPI = {
  list: (p) => api.get('/trips', { params: p }),
  get: (id) => api.get('/trips/'+id),
  playback: (id) => api.get('/trips/'+id+'/playback'),
};
if (typeof convoysAPI !== 'undefined') {
  convoysAPI.getAll = (p) => api.get('/convoys', { params: p });
  convoysAPI.updateStatus = (id, s) => api.patch('/convoys/'+id, { status: s });
}
if (typeof vehiclesAPI !== 'undefined') {
  vehiclesAPI.getAll = (p) => api.get('/vehicles', { params: p });
}
if (typeof alertsAPI !== 'undefined') {
  alertsAPI.getAll = (p) => api.get('/alerts', { params: p });
  alertsAPI.acknowledge = (id) => api.patch('/alerts/'+id, { resolved: true });
}
export const gpsAPI = { list: (p) => api.get('/gps', { params: p }) };


// ── AUTO-GENERATED EXTENSIONS ──
export const geofenceAPI = {
  list:   (p)      => api.get('/geofences',          { params: p }),
  create: (d)      => api.post('/geofences',          d),
  update: (id, d)  => api.put('/geofences/' + id,     d),
  delete: (id)     => api.delete('/geofences/' + id),
};
export const deviceAPI = {
  list:   (p)     => api.get('/devices',              { params: p }),
  create: (d)     => api.post('/devices',              d),
  update: (id, d) => api.put('/devices/' + id,         d),
  health: (id)    => api.get('/devices/' + id + '/health'),
};
export const incidentAPI = {
  list:       (p)     => api.get('/incidents',                    { params: p }),
  create:     (d)     => api.post('/incidents',                    d),
  update:     (id, d) => api.patch('/incidents/' + id,             d),
  addComment: (id, c) => api.post('/incidents/' + id + '/comments', { content: c }),
};
export const ruleAPI = {
  list:   ()          => api.get('/rules'),
  create: (d)         => api.post('/rules',             d),
  toggle: (id, en)    => api.patch('/rules/' + id,      { enabled: en }),
  delete: (id)        => api.delete('/rules/' + id),
};
export const reportAPI = {
  generate: (type, p) => api.post('/reports/generate', { type, ...p }),
  list:     ()        => api.get('/reports'),
  download: (id)      => api.get('/reports/' + id + '/download', { responseType: 'blob' }),
};
export const tripAPI = {
  list:     (p)  => api.get('/trips',                { params: p }),
  get:      (id) => api.get('/trips/' + id),
  playback: (id) => api.get('/trips/' + id + '/playback'),
};
export const gpsAPI = {
  list: (p) => api.get('/gps', { params: p }),
};
// analyticsAPI — created if not already exported
let analyticsAPI;
try { analyticsAPI = (await import('./api')).analyticsAPI; } catch(_) {}
if (!analyticsAPI) {
  analyticsAPI = {
    dashboard:        () => api.get('/analytics/dashboard'),
    convoyMetrics:    () => api.get('/analytics/convoy-metrics'),
    fleetUtilization: () => api.get('/analytics/fleet-utilization'),
  };
}
export { analyticsAPI };
// Patch existing APIs with missing methods (safe — only adds, never overwrites)
if (typeof vehiclesAPI !== 'undefined') {
  if (!vehiclesAPI.list)   vehiclesAPI.list   = (p) => api.get('/vehicles', { params: p });
  if (!vehiclesAPI.getAll) vehiclesAPI.getAll = (p) => api.get('/vehicles', { params: p });
}
if (typeof convoysAPI !== 'undefined') {
  if (!convoysAPI.getAll)      convoysAPI.getAll      = (p) => api.get('/convoys', { params: p });
  if (!convoysAPI.updateStatus) convoysAPI.updateStatus = (id, s) => api.patch('/convoys/' + id, { status: s });
}
if (typeof alertsAPI !== 'undefined') {
  if (!alertsAPI.list)        alertsAPI.list        = (p)     => api.get('/alerts', { params: p });
  if (!alertsAPI.acknowledge) alertsAPI.acknowledge = (id)    => api.patch('/alerts/' + id, { resolved: true });
  if (!alertsAPI.update)      alertsAPI.update      = (id, d) => api.patch('/alerts/' + id, d);
}

export default api;
