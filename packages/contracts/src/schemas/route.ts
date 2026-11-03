import { z } from 'zod';
import { UuidSchema, IsoDateTimeSchema, LatLngSchema } from './common.js';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const RiskFactorSchema = z.enum([
  'armed_robbery',
  'carjacking',
  'road_condition',
  'weather',
  'civil_unrest',
  'border_delay',
  'fuel_scarcity',
  'night_travel',
  'other',
]);
export type RiskFactor = z.infer<typeof RiskFactorSchema>;

// ---------------------------------------------------------------------------
// AlternateRoute
// ---------------------------------------------------------------------------

export const AlternateRouteSchema = z.object({
  label: z.string().min(1).max(128),
  waypoints: z.array(LatLngSchema).min(2),
  distance_km: z.number().nonnegative(),
  estimated_duration_minutes: z.number().int().nonnegative(),
  risk_score: z.number().min(0).max(100),
  risk_factors: z.array(RiskFactorSchema),
  notes: z.string().max(1024).nullable(),
});
export type AlternateRoute = z.infer<typeof AlternateRouteSchema>;

// ---------------------------------------------------------------------------
// RouteAnalysis
// ---------------------------------------------------------------------------

export const RouteAnalysisSchema = z.object({
  id: UuidSchema,
  org_id: UuidSchema,
  convoy_id: UuidSchema.nullable(),
  origin: LatLngSchema,
  destination: LatLngSchema,
  analysed_at: IsoDateTimeSchema,
  recommended_route: AlternateRouteSchema,
  alternate_routes: z.array(AlternateRouteSchema),
  overall_risk_score: z.number().min(0).max(100),
  primary_risk_factors: z.array(RiskFactorSchema),
  ai_summary: z.string().max(2048).nullable(),
});
export type RouteAnalysis = z.infer<typeof RouteAnalysisSchema>;

// ---------------------------------------------------------------------------
// RouteAnalysisRequest
// ---------------------------------------------------------------------------

export const RouteAnalysisRequestSchema = z.object({
  org_id: UuidSchema,
  convoy_id: UuidSchema.optional(),
  origin: LatLngSchema,
  destination: LatLngSchema,
  departure_time: IsoDateTimeSchema.optional(),
  preferences: z.object({
    avoid_night_travel: z.boolean().optional(),
    max_risk_score: z.number().min(0).max(100).optional(),
  }).optional(),
});
export type RouteAnalysisRequest = z.infer<typeof RouteAnalysisRequestSchema>;
