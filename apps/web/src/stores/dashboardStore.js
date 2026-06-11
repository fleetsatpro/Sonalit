import { create } from 'zustand';
export const useDashboardStore = create((set) => ({
    overview: null,
    alerts: [],
    vehiclePositions: new Map(),
    convoys: [],
    incidents: [],
    panicState: null,
    feedItems: [],
    selectedVehicleId: null,
    tickerEvents: [],
    setOverview: (overview) => set({ overview }),
    setAlerts: (alerts) => set({ alerts }),
    prependAlert: (alert) => set((s) => ({ alerts: [alert, ...s.alerts.filter((a) => a.id !== alert.id)].slice(0, 20) })),
    removeAlert: (id) => set((s) => ({ alerts: s.alerts.filter((a) => a.id !== id) })),
    updateVehiclePosition: (pos) => set((s) => {
        const next = new Map(s.vehiclePositions);
        next.set(pos.vehicle_id, pos);
        return { vehiclePositions: next };
    }),
    setConvoys: (convoys) => set({ convoys }),
    updateConvoy: (convoy) => set((s) => ({
        convoys: s.convoys.some((c) => c.id === convoy.id)
            ? s.convoys.map((c) => (c.id === convoy.id ? { ...c, ...convoy } : c))
            : [convoy, ...s.convoys],
    })),
    updateIncident: (incident) => set((s) => ({
        incidents: s.incidents.some((i) => i.id === incident.id)
            ? s.incidents.map((i) => (i.id === incident.id ? { ...i, ...incident } : i))
            : [incident, ...s.incidents].slice(0, 20),
    })),
    updatePanicState: (p) => set({ panicState: p.status === 'active' ? p : null }),
    prependFeedItem: (f) => set((s) => ({ feedItems: [f, ...s.feedItems].slice(0, 12) })),
    setSelectedVehicle: (selectedVehicleId) => set({ selectedVehicleId }),
    appendTickerEvent: (e) => set((s) => ({ tickerEvents: [...s.tickerEvents, e].slice(-40) })),
}));
