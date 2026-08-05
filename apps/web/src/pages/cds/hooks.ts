import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import cdsApi from './api.js';
import type {
  Shipment,
  ElectronicLock,
  Report,
  PaginatedResponse,
  SearchFilters,
  BookingPipelineItem,
} from './types.js';

/* ------------------------------------------------------------------ */
/*  Booking Pipeline                                                    */
/* ------------------------------------------------------------------ */

export function useBookingPipeline() {
  return useQuery<BookingPipelineItem[]>({
    queryKey: ['cds', 'bookings', 'pipeline'],
    queryFn: async () => {
      const { data } = await cdsApi.get('/bookings/pipeline');
      return data.data;
    },
    refetchInterval: 20_000,
  });
}

/* ------------------------------------------------------------------ */
/*  Trips                                                               */
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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cds', 'trips'] });
      qc.invalidateQueries({ queryKey: ['cds', 'bookings', 'pipeline'] });
    },
  });
}

export function useClampTrip() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      ...payload
    }: {
      id: string;
      [key: string]: unknown;
    }) => {
      const { data } = await cdsApi.post(`/trips/${id}/clamp`, payload);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cds', 'trips'] });
      qc.invalidateQueries({ queryKey: ['cds', 'bookings', 'pipeline'] });
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
      qc.invalidateQueries({ queryKey: ['cds', 'bookings', 'pipeline'] });
    },
  });
}

/* ------------------------------------------------------------------ */
/*  Electronic Locks                                                    */
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

/* ------------------------------------------------------------------ */
/*  Bookings                                                            */
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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cds', 'bookings'] });
    },
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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cds', 'bookings'] });
      qc.invalidateQueries({ queryKey: ['cds', 'bookings', 'pipeline'] });
    },
  });
}

/* ------------------------------------------------------------------ */
/*  Reports                                                             */
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
