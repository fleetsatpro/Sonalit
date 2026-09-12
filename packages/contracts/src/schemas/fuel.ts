import { z } from 'zod';
import { UuidSchema, IsoDateTimeSchema, LatLngSchema } from './common.js';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const FuelEntrySourceSchema = z.enum(['manual', 'fuel_card_webhook', 'iot_sensor']);
export type FuelEntrySource = z.infer<typeof FuelEntrySourceSchema>;

export const FuelAnomalyTypeSchema = z.enum([
  'unknown_location', 'volume_mismatch', 'consumption_spike', 'duplicate_entry', 'off_route_refuel',
]);
export type FuelAnomalyType = z.infer<typeof FuelAnomalyTypeSchema>;

// ---------------------------------------------------------------------------
// Fuel Entry
// ---------------------------------------------------------------------------

export const FuelEntrySchema = z.object({
  id: UuidSchema,
  org_id: UuidSchema,
  vehicle_id: UuidSchema,
  convoy_id: UuidSchema.nullable(),
  source: FuelEntrySourceSchema,
  station_name: z.string().nullable(),
  location: LatLngSchema.nullable(),
  volume_l: z.number().positive(),
  cost_per_l: z.number().positive().nullable(),
  total_cost: z.number().positive().nullable(),
  currency: z.string().length(3).default('USD'),
  odometer_km: z.number().nonnegative().nullable(),
  recorded_at: IsoDateTimeSchema,
  created_at: IsoDateTimeSchema,
});
export type FuelEntry = z.infer<typeof FuelEntrySchema>;

export const CreateFuelEntryInputSchema = FuelEntrySchema.omit({
  id: true,
  org_id: true,
  created_at: true,
});
export type CreateFuelEntryInput = z.infer<typeof CreateFuelEntryInputSchema>;

// ---------------------------------------------------------------------------
// Fuel Anomaly
// ---------------------------------------------------------------------------

export const FuelAnomalySchema = z.object({
  id: UuidSchema,
  org_id: UuidSchema,
  fuel_entry_id: UuidSchema,
  vehicle_id: UuidSchema,
  anomaly_type: FuelAnomalyTypeSchema,
  description: z.string(),
  expected_value: z.number().nullable(),
  actual_value: z.number().nullable(),
  alert_id: UuidSchema.nullable(),
  resolved: z.boolean().default(false),
  created_at: IsoDateTimeSchema,
});
export type FuelAnomaly = z.infer<typeof FuelAnomalySchema>;

// ---------------------------------------------------------------------------
// Approved Fuel Station
// ---------------------------------------------------------------------------

export const ApprovedFuelStationSchema = z.object({
  id: UuidSchema,
  org_id: UuidSchema,
  name: z.string(),
  location: LatLngSchema,
  radius_km: z.number().positive().default(0.2),
  active: z.boolean().default(true),
  created_at: IsoDateTimeSchema,
});
export type ApprovedFuelStation = z.infer<typeof ApprovedFuelStationSchema>;
