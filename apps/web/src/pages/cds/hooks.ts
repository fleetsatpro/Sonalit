import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import { withOfflineFallback } from '../field/fieldCache.js';

import cdsApi from './api.js';

import type { SearchFilters, Report } from './types.js';

interface ApiList { data: Record<string, unknown>[]; total: number }

export function useDashboardKPIs() {
  return useQuery({
    queryKey: ['cds', 'dashboard'],
    queryFn: async () => {
      const { data } = await cdsApi.get('/dashboard');
      return data.data as Record<string, unknown>;
    },
    refetchInterval: 30_000,
  });
}

export function useActivity(limit = 30) {
  return useQuery({
    queryKey: ['cds', 'activity', limit],
    queryFn: async () => {
      const { data } = await cdsApi.get('/activity', { params: { limit } });
      return data as Record<string, unknown>[];
    },
    refetchInterval: 20_000,
  });
}

// Realtime (useCDSRealtime) invalidates these the instant the yard or port
// acts, so the interval below is a safety floor, not the mechanism: if
// Centrifugo is down or the socket drops, a control-room board still refreshes
// on its own instead of freezing on a snapshot — which is what these five
// queries did before, having had no refetch at all.
const CONTROL_ROOM_REFETCH_MS = 60_000;

export function useTrips(filters?: SearchFilters) {
  return useQuery<ApiList>({
    queryKey: ['cds', 'trips', filters],
    queryFn: async () => {
      const { data } = await cdsApi.get('/trips', { params: filters });
      return data;
    },
    refetchInterval: CONTROL_ROOM_REFETCH_MS,
  });
}

export function useTripById(id: string) {
  return useQuery({
    queryKey: ['cds', 'trip', id],
    queryFn: async () => {
      const { data } = await cdsApi.get(`/trips/${id}`);
      return data;
    },
    enabled: !!id,
  });
}

export function useTransitionTrip() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, to_status, notes }: { id: string; to_status: string; notes?: string }) => {
      const { data } = await cdsApi.post(`/trips/${id}/transition`, { to_status, notes });
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cds', 'trips'] });
      qc.invalidateQueries({ queryKey: ['cds', 'dashboard'] });
    },
  });
}

export function useClampTrip() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...payload }: { id: string; [key: string]: unknown }) => {
      const { data } = await cdsApi.post(`/trips/${id}/clamp`, payload);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cds', 'trips'] });
      qc.invalidateQueries({ queryKey: ['cds', 'dashboard'] });
    },
  });
}

export function useUnclampTrip() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, notes }: { id: string; notes?: string }) => {
      const { data } = await cdsApi.post(`/trips/${id}/unclamp`, { notes });
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cds', 'trips'] });
      qc.invalidateQueries({ queryKey: ['cds', 'dashboard'] });
    },
  });
}

export function useContainers(filters?: SearchFilters) {
  return useQuery<ApiList>({
    queryKey: ['cds', 'containers', filters],
    queryFn: async () => {
      const { data } = await cdsApi.get('/containers', { params: filters });
      return data;
    },
    refetchInterval: CONTROL_ROOM_REFETCH_MS,
  });
}

export function useLocks(filters?: SearchFilters) {
  return useQuery<ApiList>({
    queryKey: ['cds', 'locks', filters],
    queryFn: async () => {
      const { data } = await cdsApi.get('/locks', { params: filters });
      return data;
    },
    refetchInterval: CONTROL_ROOM_REFETCH_MS,
  });
}

export function useCDSDrivers(filters?: SearchFilters) {
  return useQuery<ApiList>({
    queryKey: ['cds', 'drivers', filters],
    queryFn: async () => {
      const { data } = await cdsApi.get('/drivers', { params: filters });
      return data;
    },
  });
}

export function useCDSTransporters(filters?: SearchFilters) {
  return useQuery<ApiList>({
    queryKey: ['cds', 'transporters', filters],
    queryFn: async () => {
      const { data } = await cdsApi.get('/transporters', { params: filters });
      return data;
    },
  });
}

export function useVehicles(filters?: SearchFilters) {
  return useQuery<ApiList>({
    queryKey: ['cds', 'vehicles', filters],
    queryFn: async () => {
      const { data } = await cdsApi.get('/vehicles', { params: filters });
      return data;
    },
  });
}

export function useCustomers(filters?: SearchFilters) {
  return useQuery<ApiList>({
    queryKey: ['cds', 'customers', filters],
    queryFn: async () => {
      const { data } = await cdsApi.get('/customers', { params: filters });
      return data;
    },
  });
}

export function useBookings(filters?: SearchFilters) {
  return useQuery<ApiList>({
    queryKey: ['cds', 'bookings', filters],
    queryFn: async () => {
      const { data } = await cdsApi.get('/bookings', { params: filters });
      return data;
    },
    refetchInterval: CONTROL_ROOM_REFETCH_MS,
  });
}

export function useCreateBooking() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const { data } = await cdsApi.post('/bookings', payload);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cds', 'bookings'] });
      qc.invalidateQueries({ queryKey: ['cds', 'booking-containers'] });
      // The manifest is the default Bookings view, so a booking created with
      // containers must refresh it — otherwise the modal closes onto a table
      // that still doesn't show the rows just added.
      qc.invalidateQueries({ queryKey: ['cds', 'manifest'] });
      qc.invalidateQueries({ queryKey: ['cds', 'dashboard'] });
    },
  });
}

export function useExtractBooking() {
  return useMutation({
    mutationFn: async ({ data, mediaType }: { data: string; mediaType: string }) => {
      const { data: res } = await cdsApi.post('/bookings/extract', { data, mediaType });
      return res as { data: Record<string, unknown>; containers: Array<Record<string, unknown>>; partial: boolean; extracted_count: number; total_fields: number };
    },
  });
}

// The yard sheet: one row per container, already joined across booking, trip,
// transporter, vehicle, driver and lock. Separate from useBookingContainers,
// which is scoped to a single booking's expanded card.
export function useBookingManifest(filters?: SearchFilters) {
  return useQuery<ApiList>({
    queryKey: ['cds', 'manifest', filters],
    queryFn: async () => {
      const { data } = await cdsApi.get('/bookings/manifest', { params: filters });
      return data;
    },
    refetchInterval: CONTROL_ROOM_REFETCH_MS,
  });
}

/**
 * The manifest's integrity scan (backend/src/utils/manifestAnomalies.js).
 *
 * Deliberately a separate query from the manifest rows: it scans the whole org
 * rather than the visible page, so it must not be re-run every time somebody
 * types in the search box. It rides the same realtime invalidation as the
 * manifest, so a duplicate created by a clamp surfaces immediately.
 */
export function useManifestAnomalies() {
  return useQuery<ApiList & { by_severity?: Record<string, number>; truncated?: boolean; scanned_containers?: number }>({
    queryKey: ['cds', 'manifest', 'anomalies'],
    queryFn: async () => {
      const { data } = await cdsApi.get('/bookings/manifest/anomalies');
      return data;
    },
    refetchInterval: CONTROL_ROOM_REFETCH_MS,
  });
}

// Manifest cells are edited in place, so invalidate the manifest as well as the
// per-booking container list — the same row appears in both.
export function useUpdateBookingContainer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ bookingId, containerId, patch }: {
      bookingId: string; containerId: string; patch: Record<string, unknown>;
    }) => {
      const { data } = await cdsApi.patch(`/bookings/${bookingId}/containers/${containerId}`, patch);
      return data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['cds', 'manifest'] });
      void qc.invalidateQueries({ queryKey: ['cds', 'booking-containers'] });
      void qc.invalidateQueries({ queryKey: ['cds', 'bookings'] });
    },
  });
}

/**
 * `offline` is opt-in rather than always-on: the field app needs the last
 * good container list to survive a dead zone, but the control-room Bookings
 * view does not want a network blip silently replaced with stale data — and
 * caching every booking a desktop operator expands would bloat localStorage
 * for no benefit.
 */
export function useBookingContainers(bookingId: string, opts: { offline?: boolean } = {}) {
  return useQuery<ApiList>({
    queryKey: ['cds', 'booking-containers', bookingId],
    queryFn: async () => {
      const fetcher = async () => (await cdsApi.get<ApiList>(`/bookings/${bookingId}/containers`)).data;
      return opts.offline
        ? withOfflineFallback(`booking-containers:${bookingId}`, fetcher)
        : fetcher();
    },
    enabled: !!bookingId,
  });
}

// `enabled` because a field account only ever holds one of the two roles, and
// the backend gate in routes/cds.js 403s the other queue outright — polling it
// every 15s just to throw the answer away spends a yard tablet's battery on a
// guaranteed rejection.
export function useYardQueue(enabled = true) {
  return useQuery<{ data: Record<string, unknown>[] }>({
    queryKey: ['cds', 'field', 'yard-queue'],
    queryFn: () => withOfflineFallback('yard-queue', async () =>
      (await cdsApi.get<{ data: Record<string, unknown>[] }>('/field/yard-queue')).data),
    refetchInterval: 15_000,
    enabled,
  });
}

export function usePortQueue(enabled = true) {
  return useQuery<{ data: Record<string, unknown>[] }>({
    queryKey: ['cds', 'field', 'port-queue'],
    queryFn: () => withOfflineFallback('port-queue', async () =>
      (await cdsApi.get<{ data: Record<string, unknown>[] }>('/field/port-queue')).data),
    refetchInterval: 15_000,
    enabled,
  });
}

export function useClampBookingContainer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ bookingId, cid, ...payload }: { bookingId: string; cid: string; [k: string]: unknown }) => {
      const { data } = await cdsApi.post(`/bookings/${bookingId}/containers/${cid}/clamp`, payload);
      return data;
    },
    onSuccess: (_d, { bookingId }) => {
      qc.invalidateQueries({ queryKey: ['cds', 'field'] });
      qc.invalidateQueries({ queryKey: ['cds', 'bookings'] });
      qc.invalidateQueries({ queryKey: ['cds', 'booking-containers', bookingId] });
      qc.invalidateQueries({ queryKey: ['cds', 'trips'] });
      qc.invalidateQueries({ queryKey: ['cds', 'dashboard'] });
    },
  });
}

export function useUnclampBookingContainer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ bookingId, cid, ...payload }: { bookingId: string; cid: string; [k: string]: unknown }) => {
      const { data } = await cdsApi.post(`/bookings/${bookingId}/containers/${cid}/unclamp`, payload);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cds', 'field'] });
      qc.invalidateQueries({ queryKey: ['cds', 'bookings'] });
      qc.invalidateQueries({ queryKey: ['cds', 'booking-containers'] });
      qc.invalidateQueries({ queryKey: ['cds', 'trips'] });
      qc.invalidateQueries({ queryKey: ['cds', 'alerts'] });
      qc.invalidateQueries({ queryKey: ['cds', 'dashboard'] });
    },
  });
}

export function useAddBookingContainers() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ bookingId, containers }: { bookingId: string; containers: Record<string, unknown>[] }) => {
      const { data } = await cdsApi.post(`/bookings/${bookingId}/containers`, containers);
      return data;
    },
    onSuccess: (_data, { bookingId }) => {
      qc.invalidateQueries({ queryKey: ['cds', 'booking-containers', bookingId] });
    },
  });
}

export function useMarkBilled() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data } = await cdsApi.patch(`/bookings/${id}`, { status: 'billed' });
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cds', 'bookings'] }),
  });
}

export function useBookingPipeline() {
  return useQuery({
    queryKey: ['cds', 'bookings', 'pipeline'],
    queryFn: async () => {
      const { data } = await cdsApi.get('/bookings/pipeline');
      return data.data as Record<string, unknown>[];
    },
    refetchInterval: 20_000,
  });
}

export function useAlerts(filters?: SearchFilters) {
  return useQuery<ApiList>({
    queryKey: ['cds', 'alerts', filters],
    queryFn: async () => {
      const { data } = await cdsApi.get('/alerts', { params: filters });
      return data;
    },
    refetchInterval: CONTROL_ROOM_REFETCH_MS,
  });
}

export function useReports(filters?: SearchFilters) {
  return useQuery<{ data: Report[]; total: number }>({
    queryKey: ['cds', 'reports', filters],
    queryFn: async () => {
      const { data } = await cdsApi.get('/reports', { params: filters });
      return data;
    },
  });
}

export function useGenerateReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: Pick<Report, 'name' | 'type' | 'format' | 'parameters'>) => {
      const { data } = await cdsApi.post('/reports', payload);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cds', 'reports'] }),
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
