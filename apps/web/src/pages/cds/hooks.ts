import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
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

export function useTrips(filters?: SearchFilters) {
  return useQuery<ApiList>({
    queryKey: ['cds', 'trips', filters],
    queryFn: async () => {
      const { data } = await cdsApi.get('/trips', { params: filters });
      return data;
    },
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
  });
}

export function useLocks(filters?: SearchFilters) {
  return useQuery<ApiList>({
    queryKey: ['cds', 'locks', filters],
    queryFn: async () => {
      const { data } = await cdsApi.get('/locks', { params: filters });
      return data;
    },
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
      qc.invalidateQueries({ queryKey: ['cds', 'dashboard'] });
    },
  });
}

export function useExtractBooking() {
  return useMutation({
    mutationFn: async ({ data, mediaType }: { data: string; mediaType: string }) => {
      const { data: res } = await cdsApi.post('/bookings/extract', { data, mediaType });
      return res.data as Record<string, unknown>;
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
