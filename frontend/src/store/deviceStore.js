
import { create } from 'zustand';
export const useDeviceStore = create((set) => ({
  devices: [],
  setDevices: (d) => set({ devices: d }),
  addDevice: (d) => set((s) => ({ devices: [d, ...s.devices] })),
}));
