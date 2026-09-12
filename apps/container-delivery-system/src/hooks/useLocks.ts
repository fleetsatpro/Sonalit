import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api.js';
import type { ElectronicLock, PaginatedResponse, SearchFilters, LockEvent } from '@/types/index.js';

export function useLocks(filters?: SearchFilters) {
  return useQuery<PaginatedResponse<ElectronicLock>>({
    queryKey: ['locks', filters],
    queryFn: async () => {
      const { data } = await api.get('/locks', { params: filters });
      return data;
    },
  });
}

export function useLock(id: string) {
  return useQuery<ElectronicLock>({
    queryKey: ['lock', id],
    queryFn: async () => {
      const { data } = await api.get(`/locks/${id}`);
      return data;
    },
    enabled: !!id,
  });
}

export function useLockEvents(lockId: string) {
  return useQuery<LockEvent[]>({
    queryKey: ['lock-events', lockId],
    queryFn: async () => {
      const { data } = await api.get(`/locks/${lockId}/events`);
      return data;
    },
    enabled: !!lockId,
  });
}

export function useAssignLock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ lockId, containerId }: { lockId: string; containerId: string }) => {
      const { data } = await api.post(`/locks/${lockId}/assign`, { containerId });
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['locks'] }),
  });
}

export function useUnassignLock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (lockId: string) => {
      const { data } = await api.post(`/locks/${lockId}/unassign`);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['locks'] }),
  });
}

export function useRemoteLock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ lockId, action }: { lockId: string; action: 'lock' | 'unlock' }) => {
      const { data } = await api.post(`/locks/${lockId}/${action}`);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['locks'] }),
  });
}

export function usePingLock() {
  return useMutation({
    mutationFn: async (lockId: string) => {
      const { data } = await api.post(`/locks/${lockId}/ping`);
      return data;
    },
  });
}
