import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import cdsApi from './api.js';
import type {
  Shipment,
  Container,
  ElectronicLock,
  LockEvent,
  Driver,
  Vehicle,
  Customer,
  Transporter,
  Geofence,
  Alert,
  Incident,
  AuditLog,
  ActivityItem,
  DashboardKPI,
  Report,
  PaginatedResponse,
  SearchFilters,
} from './types.js';

/* ------------------------------------------------------------------ */
/*  Dashboard                                                          */
/* ------------------------------------------------------------------ */

interface DashboardData {
  kpis: DashboardKPI[];
  recentActivity: ActivityItem[];
  activeShipments: number;
  activeContainers: number;
  activeLocks: number;
  offlineLocks: number;
  delayedShipments: number;
  deliveredToday: number;
}

export function useDashboard() {
  return useQuery<DashboardData>({
    queryKey: ['cds', 'dashboard'],
    queryFn: async () => {
      const { data } = await cdsApi.get('/dashboard');
      return data;
    },
    refetchInterval: 30_000,
  });
}

export function useActivityFeed() {
  return useQuery<ActivityItem[]>({
    queryKey: ['cds', 'activity-feed'],
    queryFn: async () => {
      const { data } = await cdsApi.get('/activity');
      return data;
    },
    refetchInterval: 15_000,
  });
}

/* ------------------------------------------------------------------ */
/*  Shipments (Trips)                                                  */
/* ------------------------------------------------------------------ */

export function useTrips(filters?: SearchFilters) {
  return useQuery<PaginatedResponse<Shipment>>({
    queryKey: ['cds', 'trips', filters],
    queryFn: async () => {
      const { data } = await cdsApi.get('/trips', { params: filters });
      return data;
    },
  });
}

export function useTripById(id: string) {
  return useQuery<Shipment>({
    queryKey: ['cds', 'trip', id],
    queryFn: async () => {
      const { data } = await cdsApi.get(`/trips/${id}`);
      return data;
    },
    enabled: !!id,
  });
}

export function useCreateTrip() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: Partial<Shipment>) => {
      const { data } = await cdsApi.post('/trips', payload);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cds', 'trips'] }),
  });
}

export function useUpdateTrip() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      ...payload
    }: Partial<Shipment> & { id: string }) => {
      const { data } = await cdsApi.patch(`/trips/${id}`, payload);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cds', 'trips'] }),
  });
}

export function useTransitionTrip() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      to_status,
      notes,
    }: {
      id: string;
      to_status: string;
      notes?: string;
    }) => {
      const { data } = await cdsApi.post(`/trips/${id}/transition`, {
        to_status,
        notes,
      });
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cds', 'trips'] }),
  });
}

/* ------------------------------------------------------------------ */
/*  Containers                                                         */
/* ------------------------------------------------------------------ */

export function useContainers(filters?: SearchFilters) {
  return useQuery<PaginatedResponse<Container>>({
    queryKey: ['cds', 'containers', filters],
    queryFn: async () => {
      const { data } = await cdsApi.get('/containers', { params: filters });
      return data;
    },
  });
}

export function useContainerById(id: string) {
  return useQuery<Container>({
    queryKey: ['cds', 'container', id],
    queryFn: async () => {
      const { data } = await cdsApi.get(`/containers/${id}`);
      return data;
    },
    enabled: !!id,
  });
}

export function useCreateContainer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: Partial<Container>) => {
      const { data } = await cdsApi.post('/containers', payload);
      return data;
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['cds', 'containers'] }),
  });
}

export function useUpdateContainer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      ...payload
    }: Partial<Container> & { id: string }) => {
      const { data } = await cdsApi.patch(`/containers/${id}`, payload);
      return data;
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['cds', 'containers'] }),
  });
}

/* ------------------------------------------------------------------ */
/*  Electronic Locks                                                   */
/* ------------------------------------------------------------------ */

export function useLocks(filters?: SearchFilters) {
  return useQuery<PaginatedResponse<ElectronicLock>>({
    queryKey: ['cds', 'locks', filters],
    queryFn: async () => {
      const { data } = await cdsApi.get('/locks', { params: filters });
      return data;
    },
  });
}

export function useLockById(id: string) {
  return useQuery<ElectronicLock>({
    queryKey: ['cds', 'lock', id],
    queryFn: async () => {
      const { data } = await cdsApi.get(`/locks/${id}`);
      return data;
    },
    enabled: !!id,
  });
}

export function useLockEvents(lockId: string) {
  return useQuery<LockEvent[]>({
    queryKey: ['cds', 'lock-events', lockId],
    queryFn: async () => {
      const { data } = await cdsApi.get(`/locks/${lockId}/events`);
      return data;
    },
    enabled: !!lockId,
  });
}

export function useAssignLock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      lockId,
      containerId,
    }: {
      lockId: string;
      containerId: string;
    }) => {
      const { data } = await cdsApi.post(`/locks/${lockId}/assign`, {
        containerId,
      });
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cds', 'locks'] }),
  });
}

export function useUnassignLock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (lockId: string) => {
      const { data } = await cdsApi.post(`/locks/${lockId}/unassign`);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cds', 'locks'] }),
  });
}

export function useRemoteLock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      lockId,
      action,
    }: {
      lockId: string;
      action: 'lock' | 'unlock';
    }) => {
      const { data } = await cdsApi.post(`/locks/${lockId}/${action}`);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cds', 'locks'] }),
  });
}

export function usePingLock() {
  return useMutation({
    mutationFn: async (lockId: string) => {
      const { data } = await cdsApi.post(`/locks/${lockId}/ping`);
      return data;
    },
  });
}

/* ------------------------------------------------------------------ */
/*  Vehicles                                                           */
/* ------------------------------------------------------------------ */

export function useVehicles(filters?: SearchFilters) {
  return useQuery<PaginatedResponse<Vehicle>>({
    queryKey: ['cds', 'vehicles', filters],
    queryFn: async () => {
      const { data } = await cdsApi.get('/vehicles', { params: filters });
      return data;
    },
  });
}

export function useVehicleById(id: string) {
  return useQuery<Vehicle>({
    queryKey: ['cds', 'vehicle', id],
    queryFn: async () => {
      const { data } = await cdsApi.get(`/vehicles/${id}`);
      return data;
    },
    enabled: !!id,
  });
}

export function useCreateVehicle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: Partial<Vehicle>) => {
      const { data } = await cdsApi.post('/vehicles', payload);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cds', 'vehicles'] }),
  });
}

export function useUpdateVehicle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      ...payload
    }: Partial<Vehicle> & { id: string }) => {
      const { data } = await cdsApi.patch(`/vehicles/${id}`, payload);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cds', 'vehicles'] }),
  });
}

/* ------------------------------------------------------------------ */
/*  Drivers                                                            */
/* ------------------------------------------------------------------ */

export function useDrivers(filters?: SearchFilters) {
  return useQuery<PaginatedResponse<Driver>>({
    queryKey: ['cds', 'drivers', filters],
    queryFn: async () => {
      const { data } = await cdsApi.get('/drivers', { params: filters });
      return data;
    },
  });
}

export function useDriverById(id: string) {
  return useQuery<Driver>({
    queryKey: ['cds', 'driver', id],
    queryFn: async () => {
      const { data } = await cdsApi.get(`/drivers/${id}`);
      return data;
    },
    enabled: !!id,
  });
}

export function useCreateDriver() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: Partial<Driver>) => {
      const { data } = await cdsApi.post('/drivers', payload);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cds', 'drivers'] }),
  });
}

export function useUpdateDriver() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      ...payload
    }: Partial<Driver> & { id: string }) => {
      const { data } = await cdsApi.patch(`/drivers/${id}`, payload);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cds', 'drivers'] }),
  });
}

/* ------------------------------------------------------------------ */
/*  Customers                                                          */
/* ------------------------------------------------------------------ */

export function useCustomers(filters?: SearchFilters) {
  return useQuery<PaginatedResponse<Customer>>({
    queryKey: ['cds', 'customers', filters],
    queryFn: async () => {
      const { data } = await cdsApi.get('/customers', { params: filters });
      return data;
    },
  });
}

export function useCustomerById(id: string) {
  return useQuery<Customer>({
    queryKey: ['cds', 'customer', id],
    queryFn: async () => {
      const { data } = await cdsApi.get(`/customers/${id}`);
      return data;
    },
    enabled: !!id,
  });
}

export function useCreateCustomer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: Partial<Customer>) => {
      const { data } = await cdsApi.post('/customers', payload);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cds', 'customers'] }),
  });
}

export function useUpdateCustomer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      ...payload
    }: Partial<Customer> & { id: string }) => {
      const { data } = await cdsApi.patch(`/customers/${id}`, payload);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cds', 'customers'] }),
  });
}

/* ------------------------------------------------------------------ */
/*  Transporters                                                       */
/* ------------------------------------------------------------------ */

export function useTransporters(filters?: SearchFilters) {
  return useQuery<PaginatedResponse<Transporter>>({
    queryKey: ['cds', 'transporters', filters],
    queryFn: async () => {
      const { data } = await cdsApi.get('/transporters', { params: filters });
      return data;
    },
  });
}

export function useTransporterById(id: string) {
  return useQuery<Transporter>({
    queryKey: ['cds', 'transporter', id],
    queryFn: async () => {
      const { data } = await cdsApi.get(`/transporters/${id}`);
      return data;
    },
    enabled: !!id,
  });
}

export function useCreateTransporter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: Partial<Transporter>) => {
      const { data } = await cdsApi.post('/transporters', payload);
      return data;
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['cds', 'transporters'] }),
  });
}

export function useUpdateTransporter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      ...payload
    }: Partial<Transporter> & { id: string }) => {
      const { data } = await cdsApi.patch(`/transporters/${id}`, payload);
      return data;
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['cds', 'transporters'] }),
  });
}

/* ------------------------------------------------------------------ */
/*  Bookings                                                           */
/* ------------------------------------------------------------------ */

export function useBookings(filters?: SearchFilters) {
  return useQuery<PaginatedResponse<Record<string, unknown>>>({
    queryKey: ['cds', 'bookings', filters],
    queryFn: async () => {
      const { data } = await cdsApi.get('/bookings', { params: filters });
      return data;
    },
  });
}

export function useBookingById(id: string) {
  return useQuery<Record<string, unknown>>({
    queryKey: ['cds', 'booking', id],
    queryFn: async () => {
      const { data } = await cdsApi.get(`/bookings/${id}`);
      return data;
    },
    enabled: !!id,
  });
}

export function useCreateBooking() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const { data } = await cdsApi.post('/bookings', payload);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cds', 'bookings'] }),
  });
}

export function useUpdateBooking() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      ...payload
    }: Record<string, unknown> & { id: string }) => {
      const { data } = await cdsApi.patch(`/bookings/${id}`, payload);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cds', 'bookings'] }),
  });
}

/* ------------------------------------------------------------------ */
/*  Alerts                                                             */
/* ------------------------------------------------------------------ */

export function useAlerts(filters?: SearchFilters) {
  return useQuery<PaginatedResponse<Alert>>({
    queryKey: ['cds', 'alerts', filters],
    queryFn: async () => {
      const { data } = await cdsApi.get('/alerts', { params: filters });
      return data;
    },
  });
}

export function useAlertById(id: string) {
  return useQuery<Alert>({
    queryKey: ['cds', 'alert', id],
    queryFn: async () => {
      const { data } = await cdsApi.get(`/alerts/${id}`);
      return data;
    },
    enabled: !!id,
  });
}

export function useAcknowledgeAlert() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data } = await cdsApi.post(`/alerts/${id}/acknowledge`);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cds', 'alerts'] }),
  });
}

/* ------------------------------------------------------------------ */
/*  Incidents                                                          */
/* ------------------------------------------------------------------ */

export function useIncidents(filters?: SearchFilters) {
  return useQuery<PaginatedResponse<Incident>>({
    queryKey: ['cds', 'incidents', filters],
    queryFn: async () => {
      const { data } = await cdsApi.get('/incidents', { params: filters });
      return data;
    },
  });
}

export function useIncidentById(id: string) {
  return useQuery<Incident>({
    queryKey: ['cds', 'incident', id],
    queryFn: async () => {
      const { data } = await cdsApi.get(`/incidents/${id}`);
      return data;
    },
    enabled: !!id,
  });
}

export function useCreateIncident() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: Partial<Incident>) => {
      const { data } = await cdsApi.post('/incidents', payload);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cds', 'incidents'] }),
  });
}

export function useUpdateIncident() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      ...payload
    }: Partial<Incident> & { id: string }) => {
      const { data } = await cdsApi.patch(`/incidents/${id}`, payload);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cds', 'incidents'] }),
  });
}

/* ------------------------------------------------------------------ */
/*  Geofences                                                          */
/* ------------------------------------------------------------------ */

export function useGeofences(filters?: SearchFilters) {
  return useQuery<PaginatedResponse<Geofence>>({
    queryKey: ['cds', 'geofences', filters],
    queryFn: async () => {
      const { data } = await cdsApi.get('/geofences', { params: filters });
      return data;
    },
  });
}

export function useGeofenceById(id: string) {
  return useQuery<Geofence>({
    queryKey: ['cds', 'geofence', id],
    queryFn: async () => {
      const { data } = await cdsApi.get(`/geofences/${id}`);
      return data;
    },
    enabled: !!id,
  });
}

export function useCreateGeofence() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: Partial<Geofence>) => {
      const { data } = await cdsApi.post('/geofences', payload);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cds', 'geofences'] }),
  });
}

export function useUpdateGeofence() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      ...payload
    }: Partial<Geofence> & { id: string }) => {
      const { data } = await cdsApi.patch(`/geofences/${id}`, payload);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cds', 'geofences'] }),
  });
}

/* ------------------------------------------------------------------ */
/*  Documents                                                          */
/* ------------------------------------------------------------------ */

export function useDocuments(filters?: SearchFilters) {
  return useQuery<PaginatedResponse<Record<string, unknown>>>({
    queryKey: ['cds', 'documents', filters],
    queryFn: async () => {
      const { data } = await cdsApi.get('/documents', { params: filters });
      return data;
    },
  });
}

export function useDocumentById(id: string) {
  return useQuery<Record<string, unknown>>({
    queryKey: ['cds', 'document', id],
    queryFn: async () => {
      const { data } = await cdsApi.get(`/documents/${id}`);
      return data;
    },
    enabled: !!id,
  });
}

export function useUploadDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (formData: FormData) => {
      const { data } = await cdsApi.post('/documents', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cds', 'documents'] }),
  });
}

/* ------------------------------------------------------------------ */
/*  Reports                                                            */
/* ------------------------------------------------------------------ */

export function useReports(filters?: SearchFilters) {
  return useQuery<PaginatedResponse<Report>>({
    queryKey: ['cds', 'reports', filters],
    queryFn: async () => {
      const { data } = await cdsApi.get('/reports', { params: filters });
      return data;
    },
  });
}

export function useReportById(id: string) {
  return useQuery<Report>({
    queryKey: ['cds', 'report', id],
    queryFn: async () => {
      const { data } = await cdsApi.get(`/reports/${id}`);
      return data;
    },
    enabled: !!id,
  });
}

export function useGenerateReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (
      payload: Pick<Report, 'name' | 'type' | 'format' | 'parameters'>,
    ) => {
      const { data } = await cdsApi.post('/reports', payload);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cds', 'reports'] }),
  });
}

/* ------------------------------------------------------------------ */
/*  Audit Logs                                                         */
/* ------------------------------------------------------------------ */

export function useAuditLogs(filters?: SearchFilters) {
  return useQuery<PaginatedResponse<AuditLog>>({
    queryKey: ['cds', 'audit', filters],
    queryFn: async () => {
      const { data } = await cdsApi.get('/audit', { params: filters });
      return data;
    },
  });
}

export function useAuditLogById(id: string) {
  return useQuery<AuditLog>({
    queryKey: ['cds', 'audit-log', id],
    queryFn: async () => {
      const { data } = await cdsApi.get(`/audit/${id}`);
      return data;
    },
    enabled: !!id,
  });
}
