import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api.js';
import type { Container, PaginatedResponse, SearchFilters } from '@/types/index.js';

export function useContainers(filters?: SearchFilters) {
  return useQuery<PaginatedResponse<Container>>({
    queryKey: ['containers', filters],
    queryFn: async () => {
      const { data } = await api.get('/containers', { params: filters });
      return data;
    },
  });
}

export function useContainer(id: string) {
  return useQuery<Container>({
    queryKey: ['container', id],
    queryFn: async () => {
      const { data } = await api.get(`/containers/${id}`);
      return data;
    },
    enabled: !!id,
  });
}

export function useCreateContainer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: Partial<Container>) => {
      const { data } = await api.post('/containers', payload);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['containers'] }),
  });
}

export function useUpdateContainer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...payload }: Partial<Container> & { id: string }) => {
      const { data } = await api.patch(`/containers/${id}`, payload);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['containers'] }),
  });
}
