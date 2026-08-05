import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api.js';
import type { Shipment, PaginatedResponse, SearchFilters } from '@/types/index.js';

export function useShipments(filters?: SearchFilters) {
  return useQuery<PaginatedResponse<Shipment>>({
    queryKey: ['shipments', filters],
    queryFn: async () => {
      const { data } = await api.get('/shipments', { params: filters });
      return data;
    },
  });
}

export function useShipment(id: string) {
  return useQuery<Shipment>({
    queryKey: ['shipment', id],
    queryFn: async () => {
      const { data } = await api.get(`/shipments/${id}`);
      return data;
    },
    enabled: !!id,
  });
}

export function useCreateShipment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: Partial<Shipment>) => {
      const { data } = await api.post('/shipments', payload);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['shipments'] }),
  });
}

export function useUpdateShipment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...payload }: Partial<Shipment> & { id: string }) => {
      const { data } = await api.patch(`/shipments/${id}`, payload);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['shipments'] }),
  });
}

export function useTransitionShipment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status, notes }: { id: string; status: string; notes?: string }) => {
      const { data } = await api.post(`/shipments/${id}/transition`, { status, notes });
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['shipments'] }),
  });
}
