import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api/v1',
  timeout: 25000,
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
  list:         (p)       => api.get('/vehicles', { params: p }),
  get:          (id)      => api.get(`/vehicles/${id}`),
  create:       (data)    => api.post('/vehicles', data),
  update:       (id, d)   => api.put(`/vehicles/${id}`, d),
  updateStatus: (id, s)   => api.patch(`/vehicles/${id}/status`, { status: s }),
  delete:       (id)      => api.delete(`/vehicles/${id}`),
  history:      (id)      => api.get(`/vehicles/${id}/history`),
};

export const convoysAPI = {
  list:               (p)            => api.get('/convoys', { params: p }),
  get:                (id)           => api.get(`/convoys/${id}`),
  create:             (data)         => api.post('/convoys', data),
  update:             (id, d)        => api.put(`/convoys/${id}`, d),
  updateStatus:       (id, s)        => api.patch(`/convoys/${id}/status`, { status: s }),
  assign:             (id, ids)      => api.post(`/convoys/${id}/assign`, { vehicleIds: ids }),
  delete:             (id)           => api.delete(`/convoys/${id}`),
  // CFO management
  addTruck:           (id, d)        => api.post(`/convoys/${id}/trucks`, d),
  removeTruck:        (id, tid)      => api.delete(`/convoys/${id}/trucks/${tid}`),
  addCfo:             (id, d)        => api.post(`/convoys/${id}/cfos`, d),
  removeCfo:          (id, cid)      => api.delete(`/convoys/${id}/cfos/${cid}`),
  assignTruck:        (id, d)        => api.post(`/convoys/${id}/cfo-assignments`, d),
  removeAssignment:   (id, aid)      => api.delete(`/convoys/${id}/cfo-assignments/${aid}`),
  // Reports
  getReports:         (id)           => api.get(`/convoys/${id}/reports`),
  regenerateReport:   (id, date)     => api.post(`/convoys/${id}/reports/${date}/regenerate`),
};

export const alertsAPI = {
  list:         (p)       => api.get('/alerts', { params: p }),
  create:       (data)    => api.post('/alerts', data),
  acknowledge:  (id)      => api.patch(`/alerts/${id}/acknowledge`),
  resolve:      (id)      => api.patch(`/alerts/${id}/resolve`),
};

export const analyticsAPI = {
  dashboard:        () => api.get('/analytics/dashboard'),
  convoyMetrics:    () => api.get('/analytics/convoy-metrics'),
  fleetUtilization: () => api.get('/analytics/fleet-utilization'),
};

export const messagesAPI = {
  channels: ()              => api.get('/messages/channels'),
  messages: (id, p)         => api.get(`/messages/channels/${id}`, { params: p }),
  send:     (id, content)   => api.post(`/messages/channels/${id}`, { content }),
  broadcast:(content, sev)  => api.post('/messages/broadcast', { content, severity: sev }),
};

export const geofenceAPI = {
  list:         (p)       => api.get('/geofences', { params: p }),
  create:       (d)       => api.post('/geofences', d),
  update:       (id, d)   => api.put(`/geofences/${id}`, d),
  delete:       (id)      => api.delete(`/geofences/${id}`),
  listActions:  (id)      => api.get(`/geofences/${id}/actions`),
  addAction:    (id, data) => api.post(`/geofences/${id}/actions`, data),
  removeAction: (id, aId) => api.delete(`/geofences/${id}/actions/${aId}`),
  toggleAction: (id, aId) => api.patch(`/geofences/${id}/actions/${aId}/toggle`),
};

export const deviceAPI = {
  list:   (p)     => api.get('/devices', { params: p }),
  create: (d)     => api.post('/devices', d),
  update: (id, d) => api.put(`/devices/${id}`, d),
};

export const ruleAPI = {
  list:   ()        => api.get('/rules'),
  create: (d)       => api.post('/rules', d),
  toggle: (id, en)  => api.patch(`/rules/${id}`, { enabled: en }),
  delete: (id)      => api.delete(`/rules/${id}`),
};

export const incidentAPI = {
  list:       (p)     => api.get('/incidents', { params: p }),
  create:     (d)     => api.post('/incidents', d),
  update:     (id, d) => api.patch(`/incidents/${id}`, d),
  addComment: (id, c) => api.post(`/incidents/${id}/comments`, { content: c }),
};

export const sensorAPI = {
  ingest:  (data)      => api.post('/sensors', data),
  history: (vehicleId) => api.get(`/sensors/${vehicleId}`),
  latest:  (vehicleId) => api.get(`/sensors/${vehicleId}/latest`),
};

export const reportsAPI = {
  list:     ()     => api.get('/reports'),
  generate: (data) => api.post('/reports/generate', data),
  get:      (id)   => api.get(`/reports/${id}`),
};

export const documentsAPI = {
  list:     (p)    => api.get('/documents', { params: p }),
  create:   (data) => api.post('/documents', data),
  delete:   (id)   => api.delete(`/documents/${id}`),
  expiring: ()     => api.get('/documents/expiring'),
};

export const aiAPI = {
  dispatch:  (command, history) => api.post('/ai/dispatch', { command, history }),
  anomalies: ()                 => api.get('/ai/anomalies'),
  risk:      (convoyId)         => api.get(`/ai/risk/${convoyId}`),
};

export const driversAPI = {
  list:      (p)     => api.get('/drivers', { params: p }),
  get:       (id)    => api.get(`/drivers/${id}`),
  create:    (data)  => api.post('/drivers', data),
  update:    (id, d) => api.put(`/drivers/${id}`, d),
  scorecard: (id)    => api.get(`/drivers/${id}/scorecard`),
};

export const shipmentsAPI = {
  list:        (p)           => api.get('/shipments', { params: p }),
  get:         (id)          => api.get(`/shipments/${id}`),
  create:      (data)        => api.post('/shipments', data),
  updateStatus:(id, status)  => api.patch(`/shipments/${id}/status`, { status }),
  stats:       ()            => api.get('/shipments/stats/summary'),
};

export const financeAPI = {
  dashboard:     () => api.get('/finance/dashboard'),
  invoices:      (p)    => api.get('/finance/invoices', { params: p }),
  createInvoice: (data) => api.post('/finance/invoices', data),
  expenses:      (p)    => api.get('/finance/expenses', { params: p }),
  createExpense: (data) => api.post('/finance/expenses', data),
  profitability: ()     => api.get('/finance/profitability'),
};

export const maintenanceAPI = {
  list:    (p)    => api.get('/maintenance', { params: p }),
  create:  (data) => api.post('/maintenance', data),
  update:  (id,d) => api.patch(`/maintenance/${id}`, d),
  overdue: ()     => api.get('/maintenance/overdue'),
};

export const gpsAPI = {
  list: (p) => api.get('/gps', { params: p }),
};

export const riskZoneAPI = {
  list:   (p)     => api.get('/riskzones', { params: p }),
  create: (d)     => api.post('/riskzones', d),
  remove: (id)    => api.delete(`/riskzones/${id}`),
};

export const guardianAPI = {
  devices:          (p)     => api.get('/guardian/devices', { params: p }),
  device:           (id)    => api.get(`/guardian/devices/${id}`),
  updateDevice:     (id, d) => api.patch(`/guardian/devices/${id}`, d),
  revokeDevice:     (id)    => api.delete(`/guardian/devices/${id}`),
  command:          (id, d) => api.post(`/guardian/devices/${id}/command`, d),
  commands:         (id, p) => api.get(`/guardian/devices/${id}/commands`, { params: p }),
  history:          (id, p) => api.get(`/guardian/devices/${id}/history`, { params: p }),
  panic:            (p)     => api.get('/guardian/panic', { params: p }),
  resolvePanic:     (id)    => api.patch(`/guardian/panic/${id}/resolve`),
  reports:          (p)     => api.get('/guardian/reports', { params: p }),
  guardianConvoys:  ()      => api.get('/guardian/convoys'),
  convoyCodeCreate: (d)     => api.post('/guardian/convoy-codes', d),
  convoyCodeList:   ()      => api.get('/guardian/convoy-codes'),
  linkCfo: (deviceId, cfoUserId) => api.patch(`/guardian/devices/${deviceId}`, {
    assignment_type: cfoUserId ? 'user' : null,
    assignment_id: cfoUserId || null,
  }),
};

export default api;
