import { create } from 'zustand';

export type ThreatLevel = 'secure' | 'elevated' | 'critical';

export interface DashboardOverview {
  threat: { level: ThreatLevel; alerts_open: number; incidents_active: number };
  kpi: {
    vehicles_live: number;
    convoys_active: number;
    on_time_pct: number;
    incidents_open: number;
    payload_tonnes: number;
    consignments: number;
    km_today: number;
    guards_active: number;
  };
  next_delivery: { convoy_id: string; convoy_name: string; eta: string } | null;
  shift_started_at: string;
}

export interface VehiclePosition {
  vehicle_id: string;
  lat: number;
  lng: number;
  heading: number;
  speed_kmh: number;
}

export interface DashboardAlert {
  id: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  type: string;
  title: string;
  summary: string;
  convoy_id: string | null;
  occurred_at: string;
  acknowledged: boolean;
}

export interface ConvoyUpdate {
  id: string;
  name: string;
  status: string;
  progress?: number;
  lat?: number;
  lng?: number;
}

export interface IncidentUpdate {
  id: string;
  type: string;
  title: string;
  status: string;
  occurred_at: string;
}

export interface PanicEvent {
  id: string;
  status: 'active' | 'resolved';
  vehicle_id?: string;
  mode?: string;
  lat?: number;
  lng?: number;
  triggered_at: string;
  acknowledgedAt?: string | null;
  acknowledgedByName?: string | null;
  escalationLevel?: number;
}

export interface FeedItem {
  id: string;
  type: string;
  message: string;
  severity?: string;
  timestamp: string;
}

interface DashboardStore {
  overview: DashboardOverview | null;
  alerts: DashboardAlert[];
  vehiclePositions: Map<string, VehiclePosition>;
  convoys: ConvoyUpdate[];
  incidents: IncidentUpdate[];
  panicState: PanicEvent | null;
  feedItems: FeedItem[];
  selectedVehicleId: string | null;
  tickerEvents: Array<{ id: string; severity: string; message: string }>;

  setOverview: (o: DashboardOverview) => void;
  setAlerts: (a: DashboardAlert[]) => void;
  prependAlert: (a: DashboardAlert) => void;
  removeAlert: (id: string) => void;
  updateVehiclePosition: (pos: VehiclePosition) => void;
  setConvoys: (c: ConvoyUpdate[]) => void;
  updateConvoy: (c: ConvoyUpdate) => void;
  updateIncident: (i: IncidentUpdate) => void;
  updatePanicState: (p: PanicEvent) => void;
  acknowledgePanicState: (id: string, acknowledgedAt: string, acknowledgedByName: string | null) => void;
  escalatePanicState: (id: string, escalationLevel: number) => void;
  prependFeedItem: (f: FeedItem) => void;
  setSelectedVehicle: (id: string | null) => void;
  appendTickerEvent: (e: { id: string; severity: string; message: string }) => void;
}

export const useDashboardStore = create<DashboardStore>((set) => ({
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

  prependAlert: (alert) =>
    set((s) => ({ alerts: [alert, ...s.alerts.filter((a) => a.id !== alert.id)].slice(0, 20) })),

  removeAlert: (id) =>
    set((s) => ({ alerts: s.alerts.filter((a) => a.id !== id) })),

  updateVehiclePosition: (pos) =>
    set((s) => {
      const next = new Map(s.vehiclePositions);
      next.set(pos.vehicle_id, pos);
      return { vehiclePositions: next };
    }),

  setConvoys: (convoys) => set({ convoys }),

  updateConvoy: (convoy) =>
    set((s) => ({
      convoys: s.convoys.some((c) => c.id === convoy.id)
        ? s.convoys.map((c) => (c.id === convoy.id ? { ...c, ...convoy } : c))
        : [convoy, ...s.convoys],
    })),

  updateIncident: (incident) =>
    set((s) => ({
      incidents: s.incidents.some((i) => i.id === incident.id)
        ? s.incidents.map((i) => (i.id === incident.id ? { ...i, ...incident } : i))
        : [incident, ...s.incidents].slice(0, 20),
    })),

  updatePanicState: (p) =>
    set((s) => {
      if (p.status !== 'active') return { panicState: null };
      // Merge onto an in-flight panic of the same id so a fresh 'panic'
      // publish (e.g. re-delivered on reconnect) doesn't wipe out
      // acknowledged/escalation state already reflected in the UI.
      if (s.panicState?.id === p.id) {
        return { panicState: { ...s.panicState, ...p } };
      }
      return { panicState: p };
    }),

  acknowledgePanicState: (id, acknowledgedAt, acknowledgedByName) =>
    set((s) =>
      s.panicState?.id === id
        ? { panicState: { ...s.panicState, acknowledgedAt, acknowledgedByName } }
        : {}
    ),

  escalatePanicState: (id, escalationLevel) =>
    set((s) =>
      s.panicState?.id === id
        ? { panicState: { ...s.panicState, escalationLevel } }
        : {}
    ),

  prependFeedItem: (f) =>
    set((s) => ({ feedItems: [f, ...s.feedItems].slice(0, 12) })),

  setSelectedVehicle: (selectedVehicleId) => set({ selectedVehicleId }),

  appendTickerEvent: (e) =>
    set((s) => ({ tickerEvents: [...s.tickerEvents, e].slice(-40) })),
}));
