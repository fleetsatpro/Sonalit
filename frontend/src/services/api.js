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

export default api;
