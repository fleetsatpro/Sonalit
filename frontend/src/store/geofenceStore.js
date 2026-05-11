
import { create } from 'zustand';
export const useGeofenceStore = create((set) => ({
  geofences: [],
  setGeofences: (g) => set({ geofences: g }),
  addGeofence: (g) => set((s) => ({ geofences: [g, ...s.geofences] })),
  removeGeofence: (id) => set((s) => ({ geofences: s.geofences.filter(x => x.id !== id) })),
}));
