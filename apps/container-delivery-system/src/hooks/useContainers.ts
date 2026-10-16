import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api.js';
import type { Container, PaginatedResponse, SearchFilters } from '@/types/index.js';

type RawRow = Record<string, unknown>;
function text(row: RawRow, key: string): string {
  const value = row[key];
  return value == null ? '' : String(value);
}
function numeric(row: RawRow, key: string): number {
  const value = Number(row[key]);
  return Number.isFinite(value) ? value : 0;
}
function toContainer(value: unknown): Container {
  const row = (value && typeof value === 'object' ? value : {}) as RawRow;
  return {
    id: text(row, 'id'),
    number: text(row, 'number'),
    isoType: text(row, 'iso_type'),
    containerType: text(row, 'container_type'),
    containerSize: numeric(row, 'container_size'),
    ownership: (text(row, 'ownership') || 'leased') as Container['ownership'],
    status: (text(row, 'status') || 'available') as Container['status'],
    condition: (text(row, 'condition') || 'good') as NonNullable<Container['condition']>,
    length: numeric(row, 'length_m'),
    width: numeric(row, 'width_m'),
    height: numeric(row, 'height_m'),
    maxWeight: numeric(row, 'max_weight_kg'),
    tareWeight: numeric(row, 'tare_weight_kg'),
    currentShipmentId: null,
    currentVehicleId: text(row, 'vehicle_id') || null,
    currentLockId: text(row, 'lock_id') || null,
    lat: row['lat'] == null ? null : numeric(row, 'lat'),
    lng: row['lng'] == null ? null : numeric(row, 'lng'),
    currentLocation: text(row, 'current_location'),
    lastInspection: text(row, 'last_inspection') || null,
    nextInspection: text(row, 'next_inspection') || null,
    manufacturer: text(row, 'manufacturer'),
    yearBuilt: numeric(row, 'year_built'),
    createdAt: text(row, 'created_at'),
    updatedAt: text(row, 'updated_at'),
  };
}

function writePayload(input: Partial<Container>): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  const assign = (key: string, value: unknown) => { if (value !== undefined) payload[key] = value; };
  assign('number', input.number);
  assign('iso_type', input.isoType);
  assign('container_type', input.containerType);
  assign('container_size', input.containerSize);
  assign('ownership', input.ownership);
  assign('max_weight_kg', input.maxWeight);
  assign('tare_weight_kg', input.tareWeight);
  assign('manufacturer', input.manufacturer);
  assign('year_built', input.yearBuilt);
  assign('condition', input.condition);
  assign('status', input.status);
  assign('current_location', input.currentLocation);
  return payload;
}

export function useContainers(filters?: SearchFilters) {
  return useQuery<PaginatedResponse<Container>>({
    queryKey: ['containers', filters],
    queryFn: async () => {
      const pageSize = Math.max(1, Math.min(200, filters?.pageSize ?? 200));
      const page = Math.max(1, filters?.page ?? 1);
      const params = {
        limit: pageSize,
        offset: (page - 1) * pageSize,
        ...(filters?.status ? { status: filters.status } : {}),
        ...(filters?.query ? { search: filters.query } : {}),
      };
      const { data: body } = await api.get('/containers', { params });
      const rows = (Array.isArray(body.data) ? body.data : []).map(toContainer);
      const total = Number(body.total ?? rows.length);
      return { data: rows, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
    },
    refetchInterval: 30_000,
  });
}

export function useContainer(id: string) {
  return useQuery<Container>({
    queryKey: ['container', id],
    queryFn: async () => {
      const { data: body } = await api.get('/containers/' + id);
      return toContainer(body.data ?? body);
    },
    enabled: !!id,
  });
}

export function useCreateContainer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: Partial<Container>) => {
      const { data } = await api.post('/containers', writePayload(payload));
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['containers'] }),
  });
}

export function useUpdateContainer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...payload }: Partial<Container> & { id: string }) => {
      const { data } = await api.patch('/containers/' + id, writePayload(payload));
      return data;
    },
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ['containers'] });
      qc.invalidateQueries({ queryKey: ['container', variables.id] });
    },
  });
}
