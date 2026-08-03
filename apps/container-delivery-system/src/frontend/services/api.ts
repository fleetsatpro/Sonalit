// API Service for CDS

import axios from 'axios';
import { useAuthStore } from '../store/auth';

const API_BASE_URL = import.meta.env.VITE_API_URL || '/api/v1/cds';

export const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor to add auth token
api.interceptors.request.use(
  (config) => {
    const { accessToken } = useAuthStore.getState();
    if (accessToken) {
      config.headers.Authorization = `Bearer ${accessToken}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor for error handling
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401) {
      const { logout } = useAuthStore.getState();
      logout();
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

// Shipments API
export const shipmentsApi = {
  list: (params?: Record<string, any>) =>
    api.get('/shipments', { params }),
  getById: (id: string) =>
    api.get(`/shipments/${id}`),
  create: (data: any) =>
    api.post('/shipments', data),
  update: (id: string, data: any) =>
    api.patch(`/shipments/${id}`, data),
  transitionStatus: (id: string, status: string, notes?: string) =>
    api.post(`/shipments/${id}/status`, { status, notes }),
  getTimeline: (id: string) =>
    api.get(`/shipments/${id}/timeline`),
  getStats: () =>
    api.get('/shipments/stats'),
};

// Containers API
export const containersApi = {
  list: (params?: Record<string, any>) =>
    api.get('/containers', { params }),
  getById: (id: string) =>
    api.get(`/containers/${id}`),
  create: (data: any) =>
    api.post('/containers', data),
  update: (id: string, data: any) =>
    api.patch(`/containers/${id}`, data),
  delete: (id: string) =>
    api.delete(`/containers/${id}`),
  getStats: () =>
    api.get('/containers/stats'),
};

// Locks API
export const locksApi = {
  list: (params?: Record<string, any>) =>
    api.get('/locks', { params }),
  getById: (id: string) =>
    api.get(`/locks/${id}`),
  create: (data: any) =>
    api.post('/locks', data),
  update: (id: string, data: any) =>
    api.patch(`/locks/${id}`, data),
  lock: (id: string) =>
    api.post(`/locks/${id}/lock`),
  unlock: (id: string) =>
    api.post(`/locks/${id}/unlock`),
  assign: (id: string, shipmentId: string, vehicleId: string) =>
    api.post(`/locks/${id}/assign`, { shipmentId, vehicleId }),
  unassign: (id: string) =>
    api.post(`/locks/${id}/unassign`),
  sync: (id: string) =>
    api.post(`/locks/${id}/sync`),
  syncAll: () =>
    api.post('/locks/sync-all'),
  getEvents: (id: string) =>
    api.get(`/locks/${id}/events`),
  getStats: () =>
    api.get('/locks/stats'),
};

// Customers API
export const customersApi = {
  list: (params?: Record<string, any>) =>
    api.get('/customers', { params }),
  getById: (id: string) =>
    api.get(`/customers/${id}`),
  create: (data: any) =>
    api.post('/customers', data),
  update: (id: string, data: any) =>
    api.patch(`/customers/${id}`, data),
  delete: (id: string) =>
    api.delete(`/customers/${id}`),
};

// Vehicles API
export const vehiclesApi = {
  list: (params?: Record<string, any>) =>
    api.get('/vehicles', { params }),
  getById: (id: string) =>
    api.get(`/vehicles/${id}`),
  create: (data: any) =>
    api.post('/vehicles', data),
  update: (id: string, data: any) =>
    api.patch(`/vehicles/${id}`, data),
  updateLocation: (id: string, location: { lat: number; lng: number }) =>
    api.patch(`/vehicles/${id}/location`, location),
  delete: (id: string) =>
    api.delete(`/vehicles/${id}`),
  getStats: () =>
    api.get('/vehicles/stats'),
};

// Drivers API
export const driversApi = {
  list: (params?: Record<string, any>) =>
    api.get('/drivers', { params }),
  getById: (id: string) =>
    api.get(`/drivers/${id}`),
  create: (data: any) =>
    api.post('/drivers', data),
  update: (id: string, data: any) =>
    api.patch(`/drivers/${id}`, data),
  delete: (id: string) =>
    api.delete(`/drivers/${id}`),
  getStats: () =>
    api.get('/drivers/stats'),
};

// Alerts API
export const alertsApi = {
  list: (params?: Record<string, any>) =>
    api.get('/alerts', { params }),
  getById: (id: string) =>
    api.get(`/alerts/${id}`),
  acknowledge: (id: string) =>
    api.post(`/alerts/${id}/acknowledge`),
  resolve: (id: string) =>
    api.post(`/alerts/${id}/resolve`),
};

// Reports API
export const reportsApi = {
  list: (params?: Record<string, any>) =>
    api.get('/reports', { params }),
  generate: (type: string, params: Record<string, any>) =>
    api.post(`/reports/generate`, { type, ...params }),
  download: (id: string, format: 'pdf' | 'excel' | 'csv') =>
    api.get(`/reports/${id}/download`, { params: { format }, responseType: 'blob' }),
};

// Analytics API
export const analyticsApi = {
  dashboard: () =>
    api.get('/analytics/dashboard'),
  shipmentPerformance: (params?: Record<string, any>) =>
    api.get('/analytics/shipment-performance', { params }),
  lockUtilization: (params?: Record<string, any>) =>
    api.get('/analytics/lock-utilization', { params }),
  deliveryMetrics: (params?: Record<string, any>) =>
    api.get('/analytics/delivery-metrics', { params }),
};

// GPS Tracking API
export const trackingApi = {
  getLivePositions: () =>
    api.get('/tracking/live'),
  getHistory: (entityType: string, entityId: string, from: string, to: string) =>
    api.get(`/tracking/history`, { params: { entityType, entityId, from, to } }),
};

// Geofences API
export const geofencesApi = {
  list: (params?: Record<string, any>) =>
    api.get('/geofences', { params }),
  getById: (id: string) =>
    api.get(`/geofences/${id}`),
  create: (data: any) =>
    api.post('/geofences', data),
  update: (id: string, data: any) =>
    api.patch(`/geofences/${id}`, data),
  delete: (id: string) =>
    api.delete(`/geofences/${id}`),
};
