import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api.js';
import type { ElectronicLock, PaginatedResponse, SearchFilters, LockEvent } from '@/types/index.js';

export function useLocks(filters?: SearchFilters) {
  return useQuery<PaginatedResponse<ElectronicLock>>({
    queryKey: ['locks', filters],
    queryFn: async () => {
      const pageSize = Math.max(1, Math.min(200, Number(filters?.pageSize ?? 200)));
      const page = Math.max(1, Number(filters?.page ?? 1));
      const params = {
        limit: pageSize,
        offset: (page - 1) * pageSize,
        ...(filters?.status ? { status: filters.status } : {}),
        ...(filters?.query ? { search: filters.query } : {}),
      };
      const { data } = await api.get('/locks', { params });
      const rows = Array.isArray(data.data) ? data.data : [];
      const total = Number(data.total ?? rows.length);
      const pageSize = Math.max(1, Number(filters?.pageSize ?? 200));
      const page = Math.max(1, Number(filters?.page ?? 1));
      return { data: rows, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
    },
    refetchInterval: 30_000,
    staleTime: 10_000,
    retry: 1,
  });
}

export function useLock(id: string) {
  return useQuery<ElectronicLock>({
    queryKey: ['lock', id],
    queryFn: async () => {
      const { data: body } = await api.get('/locks/' + id);
      return (body.data ?? body) as ElectronicLock;
    },
    enabled: !!id,
  });
}

export function useLockEvents(lockId: string) {
  return useQuery<LockEvent[]>({
    queryKey: ['lock-events', lockId],
    queryFn: async () => {
      const { data: body } = await api.get('/locks/' + lockId + '/events');
      return Array.isArray(body.data) ? body.data as LockEvent[] : [];
    },
    enabled: !!lockId,
  });
}

export function useCreateLock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { serial: string; provider?: string; firmware_version?: string; status: string; battery_level: number }) => {
      const { data } = await api.post('/locks', payload);
      return data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['locks'] });
    },
  });
}

export function useUpdateLock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...payload }: { id: string; serial?: string; provider?: string; firmware_version?: string; status?: string; battery_level?: number; container_id?: string | null; vehicle_id?: string | null; location?: string | null }) => {
      const { data } = await api.patch('/locks/' + id, payload);
      return data;
    },
    onSuccess: (_data, variables) => {
      void qc.invalidateQueries({ queryKey: ['locks'] });
      void qc.invalidateQueries({ queryKey: ['lock', variables.id] });
    },
  });
}

