import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api/v1',
  timeout: 20000,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

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

export const authAPI = {
  login:          (email, password) => api.post('/auth/login', { email, password }),
  me:             ()                => api.get('/auth/me'),
  logout:         ()                => api.post('/auth/logout'),
  changePassword: (data)            => api.put('/auth/change-password', data),
};

export const vehiclesAPI = {
  list:         (params)     => api.get('/vehicles', { params }),
  get:          (id)         => api.get(`/vehicles/${id}`),
  create:       (data)       => api.post('/vehicles', data),
  update:       (id, data)   => api.put(`/vehicles/${id}`, data),
  updateStatus: (id, status) => api.patch(`/vehicles/${id}/status`, { status }),
  delete:       (id)         => api.delete(`/vehicles/${id}`),
  history:      (id)         => api.get(`/vehicles/${id}/history`),
};

export const convoysAPI = {
  list:         (params)         => api.get('/convoys', { params }),
  get:          (id)             => api.get(`/convoys/${id}`),
  create:       (data)           => api.post('/convoys', data),
  update:       (id, data)       => api.put(`/convoys/${id}`, data),
  updateStatus: (id, status)     => api.patch(`/convoys/${id}/status`, { status }),
  assign:       (id, vehicleIds) => api.post(`/convoys/${id}/assign`, { vehicleIds }),
  delete:       (id)             => api.delete(`/convoys/${id}`),
  events:       (id)             => api.get(`/convoys/${id}/events`),
  risk:         (id)             => api.get(`/ai/risk/${id}`),
};

export const alertsAPI = {
  list:        (params)   => api.get('/alerts', { params }),
  get:         (id)       => api.get(`/alerts/${id}`),
  create:      (data)     => api.post('/alerts', data),
  update:      (id, data) => api.patch(`/alerts/${id}`, data),
  acknowledge: (id)       => api.patch(`/alerts/${id}/acknowledge`),
  resolve:     (id)       => api.patch(`/alerts/${id}/resolve`),
};

export const analyticsAPI = {
  dashboard:        () => api.get('/analytics/dashboard'),
  convoyMetrics:    () => api.get('/analytics/convoy-metrics'),
  fleetUtilization: () => api.get('/analytics/fleet-utilization'),
};

export const messagesAPI = {
  channels:  ()                  => api.get('/messages/channels'),
  messages:  (channelId, params) => api.get(`/messages/channels/${channelId}`, { params }),
  send:      (channelId, content)=> api.post(`/messages/channels/${channelId}`, { content }),
  broadcast: (content, severity) => api.post('/messages/broadcast', { content, severity }),
};

export const geofenceAPI = {
  list:   (p)     => api.get('/geofences',        { params: p }),
  create: (d)     => api.post('/geofences',         d),
  update: (id, d) => api.put(`/geofences/${id}`,    d),
  delete: (id)    => api.delete(`/geofences/${id}`),
};

export const deviceAPI = {
  list:   (p)     => api.get('/devices',           { params: p }),
  create: (d)     => api.post('/devices',            d),
  update: (id, d) => api.put(`/devices/${id}`,       d),
  health: (id)    => api.get(`/devices/${id}/health`),
};

export const ruleAPI = {
  list:   ()       => api.get('/rules'),
  create: (d)      => api.post('/rules',            d),
  toggle: (id, en) => api.patch(`/rules/${id}`,     { enabled: en }),
  delete: (id)     => api.delete(`/rules/${id}`),
};

export const incidentAPI = {
  list:       (p)     => api.get('/incidents',              { params: p }),
  create:     (d)     => api.post('/incidents',              d),
  update:     (id, d) => api.patch(`/incidents/${id}`,       d),
  addComment: (id, c) => api.post(`/incidents/${id}/comments`, { content: c }),
};

export const sensorAPI = {
  ingest:  (data)       => api.post('/sensors', data),
  history: (vehicleId)  => api.get(`/sensors/${vehicleId}`),
  latest:  (vehicleId)  => api.get(`/sensors/${vehicleId}/latest`),
};

export const reportsAPI = {
  list:     ()     => api.get('/reports'),
  generate: (data) => api.post('/reports/generate', data),
  get:      (id)   => api.get(`/reports/${id}`),
};

export const documentsAPI = {
  list:     (params) => api.get('/documents', { params }),
  create:   (data)   => api.post('/documents', data),
  delete:   (id)     => api.delete(`/documents/${id}`),
  expiring: ()       => api.get('/documents/expiring'),
};

export const aiAPI = {
  dispatch:  (command, history) => api.post('/ai/dispatch', { command, history }),
  anomalies: ()                 => api.get('/ai/anomalies'),
  risk:      (convoyId)         => api.get(`/ai/risk/${convoyId}`),
};

export const gpsAPI = {
  list: (p) => api.get('/gps', { params: p }),
};

export default api;
