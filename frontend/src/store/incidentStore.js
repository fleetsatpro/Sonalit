
import { create } from 'zustand';
export const useIncidentStore = create((set) => ({
  incidents: [],
  setIncidents: (i) => set({ incidents: i }),
  addIncident: (i) => set((s) => ({ incidents: [i, ...s.incidents] })),
  updateIncident: (id, data) => set((s) => ({ incidents: s.incidents.map(x => x.id===id?{...x,...data}:x) })),
}));
