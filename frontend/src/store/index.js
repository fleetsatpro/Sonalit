import { create } from 'zustand';
import { authAPI, vehiclesAPI, convoysAPI, alertsAPI } from '../services/api';
import toast from 'react-hot-toast';

// ── Auth Store ────────────────────────────────────────────────────────
export const useAuthStore = create((set, get) => ({
  user: null,
  token: localStorage.getItem('token'),
  loading: false,

  login: async (email, password) => {
    set({ loading: true });
    try {
      const res = await authAPI.login(email, password);
      const { token, user } = res.data;
      localStorage.setItem('token', token);
      set({ token, user, loading: false });
      return { ok: true };
    } catch (err) {
      set({ loading: false });
      return { ok: false, error: err.response?.data?.error || 'Login failed' };
    }
  },

  logout: () => {
    authAPI.logout().catch(() => {});
    localStorage.removeItem('token');
    set({ user: null, token: null });
  },

  fetchMe: async () => {
    try {
      const res = await authAPI.me();
      set({ user: res.data.user });
    } catch {
      localStorage.removeItem('token');
      set({ user: null, token: null });
    }
  },
}));

// ── Vehicle Store ─────────────────────────────────────────────────────
export const useVehicleStore = create((set, get) => ({
  vehicles: [], total: 0, loading: false, pagination: null,

  fetchVehicles: async (params = {}) => {
    set({ loading: true });
    try {
      const res = await vehiclesAPI.list(params);
      const pagination = res.data.pagination || {};
      set({ vehicles: res.data.data || [], pagination, total: parseInt(pagination.totalCount || res.data.total || 0), loading: false });
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to load vehicles');
      set({ loading: false });
    }
  },

  createVehicle: async (data) => {
    const res = await vehiclesAPI.create(data);
    set((s) => ({ vehicles: [res.data.data, ...s.vehicles], total: s.total + 1 }));
    return res.data.data;
  },

  updateVehicle: async (id, data) => {
    const res = await vehiclesAPI.update(id, data);
    set((s) => ({ vehicles: s.vehicles.map((v) => v.id === id ? res.data.data : v) }));
    return res.data.data;
  },

  updateStatus: async (id, status) => {
    const res = await vehiclesAPI.updateStatus(id, status);
    set((s) => ({ vehicles: s.vehicles.map((v) => v.id === id ? { ...v, status } : v) }));
  },

  deleteVehicle: async (id) => {
    await vehiclesAPI.delete(id);
    set((s) => ({ vehicles: s.vehicles.filter((v) => v.id !== id), total: s.total - 1 }));
  },

  liveUpdateVehicle: (update) => {
    set((s) => ({
      vehicles: s.vehicles.map((v) =>
        v.id === update.vehicleId ? { ...v, latitude: update.lat, longitude: update.lng } : v
      ),
    }));
  },
}));

// ── Convoy Store ──────────────────────────────────────────────────────
export const useConvoyStore = create((set) => ({
  convoys: [], total: 0, loading: false,

  fetchConvoys: async (params = {}) => {
    set({ loading: true });
    try {
      const res = await convoysAPI.list(params);
      const pg2 = res.data.pagination || {};
      set({ convoys: res.data.data || [], total: pg2.totalCount || res.data.total || 0, loading: false });
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to load convoys');
      set({ loading: false });
    }
  },

  createConvoy: async (data) => {
    const res = await convoysAPI.create(data);
    set((s) => ({ convoys: [res.data.data, ...s.convoys] }));
    return res.data.data;
  },

  updateStatus: async (id, status) => {
    await convoysAPI.updateStatus(id, status);
    set((s) => ({ convoys: s.convoys.map((c) => c.id === id ? { ...c, status } : c) }));
  },

  deleteConvoy: async (id) => {
    await convoysAPI.delete(id);
    set((s) => ({ convoys: s.convoys.filter((c) => c.id !== id) }));
  },
}));

// ── Alert Store ───────────────────────────────────────────────────────
export const useAlertStore = create((set) => ({
  alerts: [], total: 0, unreadCount: 0, loading: false,

  fetchAlerts: async (params = {}) => {
    set({ loading: true });
    try {
      const res = await alertsAPI.list(params);
      const unread = res.data.data.filter((a) => !a.acknowledged_at).length;
      const pg3 = res.data.pagination || {};
      set({ alerts: res.data.data || [], total: pg3.totalCount || res.data.total || 0, unreadCount: unread, loading: false });
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to load alerts');
      set({ loading: false });
    }
  },

  addLiveAlert: (alert) => {
    set((s) => ({ alerts: [alert, ...s.alerts], unreadCount: s.unreadCount + 1 }));
    toast.error(`🚨 ${alert.severity.toUpperCase()}: ${alert.message}`, { duration: 6000 });
  },

  acknowledge: async (id) => {
    const res = await alertsAPI.acknowledge(id);
    set((s) => ({
      alerts: s.alerts.map((a) => a.id === id ? res.data.data : a),
      unreadCount: Math.max(0, s.unreadCount - 1),
    }));
  },

  resolve: async (id) => {
    const res = await alertsAPI.resolve(id);
    set((s) => ({ alerts: s.alerts.map((a) => a.id === id ? res.data.data : a) }));
  },
}));
