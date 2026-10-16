import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api.js';
import type { Shipment, PaginatedResponse, SearchFilters, ShipmentStatus, RiskLevel } from '@/types/index.js';

type RawRow = Record<string, unknown>;

function text(row: RawRow, ...keys: string[]): string {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') return String(value);
  }
  return '';
}

function nullableText(row: RawRow, ...keys: string[]): string | null {
  const value = text(row, ...keys);
  return value ? value : null;
}

function numberValue(row: RawRow, ...keys: string[]): number {
  const value = text(row, ...keys);
  const parsed = Number(value);
  return value && Number.isFinite(parsed) ? parsed : 0;
}

/** Convert the persisted CDS trip row into the standalone app's display contract. */
function toShipment(value: unknown): Shipment {
  const row = (value && typeof value === 'object' ? value : {}) as RawRow;
  return {
    id: text(row, 'id'),
    reference: text(row, 'reference', 'trip_number', 'id'),
    status: text(row, 'status', 'created') as ShipmentStatus,
    customerId: text(row, 'customer_id'),
    customerName: text(row, 'customer_name', 'customerName'),
    containerId: nullableText(row, 'container_id'),
    containerNumber: nullableText(row, 'container_number', 'containerNumber'),
    vehicleId: nullableText(row, 'vehicle_id'),
    vehicleReg: nullableText(row, 'vehicleReg', 'vehicle_reg'),
    driverId: nullableText(row, 'driver_id'),
    driverName: nullableText(row, 'driverName', 'driver_name'),
    lockId: nullableText(row, 'lock_id'),
    lockSerial: nullableText(row, 'lock_serial', 'lockSerial'),
    transporterId: text(row, 'transporter_id'),
    transporterName: text(row, 'transporter_name', 'transporterName'),
    commodity: text(row, 'commodity'),
    weight: numberValue(row, 'weight_kg', 'weight'),
    origin: text(row, 'origin'),
    destination: text(row, 'destination'),
    eta: nullableText(row, 'eta'),
    departedAt: nullableText(row, 'departed_at', 'departedAt'),
    arrivedAt: nullableText(row, 'arrived_at', 'arrivedAt'),
    deliveredAt: nullableText(row, 'delivered_at', 'deliveredAt'),
    closedAt: nullableText(row, 'closed_at', 'closedAt'),
    risk: text(row, 'risk', 'low') as RiskLevel,
    progress: numberValue(row, 'progress'),
    bookingRef: nullableText(row, 'booking_number', 'booking_ref', 'booking_id'),
    sealNumber: nullableText(row, 'seal_number', 'sealNumber'),
    notes: text(row, 'notes'),
    createdAt: text(row, 'created_at', 'createdAt'),
    updatedAt: text(row, 'updated_at', 'updatedAt'),
  };
}

function tripWritePayload(input: Partial<Shipment>): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  const assign = (key: string, value: unknown) => { if (value !== undefined) payload[key] = value; };
  assign('customer_id', input.customerId);
  assign('driver_id', input.driverId);
  assign('vehicle_id', input.vehicleId);
  assign('container_id', input.containerId);
  assign('lock_id', input.lockId);
  assign('transporter_id', input.transporterId);
  assign('origin', input.origin);
  assign('destination', input.destination);
  assign('eta', input.eta);
  assign('commodity', input.commodity);
  assign('weight_kg', input.weight);
  assign('seal_number', input.sealNumber);
  assign('notes', input.notes);
  assign('booking_id', input.bookingRef);
  assign('risk', input.risk);
  assign('progress', input.progress);
  return payload;
}

export function useShipments(filters?: SearchFilters) {
  return useQuery<PaginatedResponse<Shipment>>({
    queryKey: ['shipments', filters],
    queryFn: async () => {
      const { data: body } = await api.get('/trips', { params: filters });
      const rows = Array.isArray(body.data) ? body.data : [];
      return { data: rows.map(toShipment), total: Number(body.total ?? rows.length) };
    },
    refetchInterval: 30_000,
  });
}

export function useShipment(id: string) {
  return useQuery<Shipment>({
    queryKey: ['shipment', id],
    queryFn: async () => {
      const { data: body } = await api.get('/trips/' + id);
      return toShipment(body.data ?? body);
    },
    enabled: !!id,
  });
}

export function useCreateShipment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: Partial<Shipment>) => {
      const { data } = await api.post('/trips', tripWritePayload(payload));
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['shipments'] }),
  });
}

export function useUpdateShipment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...payload }: Partial<Shipment> & { id: string }) => {
      const { data } = await api.patch('/trips/' + id, tripWritePayload(payload));
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['shipments'] }),
  });
}

export function useTransitionShipment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status, notes }: { id: string; status: ShipmentStatus; notes?: string }) => {
      const { data } = await api.post('/trips/' + id + '/transition', { to_status: status, notes });
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['shipments'] }),
  });
}
