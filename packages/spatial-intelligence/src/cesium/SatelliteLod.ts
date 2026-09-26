import type { SpatialSatelliteObservation } from '../model/spatialSatellite.js';

export type SatelliteLodTier = 'point' | 'label' | 'detail' | 'hidden';

export interface SatelliteGeoJsonPointFeature {
  type: 'Feature';
  geometry: { type: 'Point'; coordinates: [number, number] };
  properties: Record<string, unknown>;
}

export interface SatelliteLodBudget {
  maxPoints: number;
  maxLabels: number;
  maxDetails: number;
}

export interface SatelliteLodOptions {
  detailMaxHeightM?: number;
  labelMaxHeightM?: number;
  pointMaxHeightM?: number;
  budget?: Partial<SatelliteLodBudget>;
}

export interface SatelliteLodItem {
  satellite: SpatialSatelliteObservation;
  tier: Exclude<SatelliteLodTier, 'hidden'>;
  feature: SatelliteGeoJsonPointFeature;
  caption: string;
}

export const DEFAULT_SATELLITE_LOD_BUDGET: SatelliteLodBudget = {
  maxPoints: 40,
  maxLabels: 12,
  maxDetails: 4,
};

export const SATELLITE_LOD_HEIGHTS_M = {
  detail: 2_500_000,
  label: 10_000_000,
  point: 50_000_000,
} as const;

export const SATELLITE_MODELLED_CAPTION =
  'modelled orbital position (not live telemetry; not an imaging claim)';

function finite(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function isModelledSatellite(satellite: SpatialSatelliteObservation): boolean {
  const attributes = satellite.attributes ?? {};
  const source = String(
    attributes.positionSource ??
      (satellite as SpatialSatelliteObservation & { positionSource?: string }).positionSource ??
      '',
  ).toLowerCase();
  const mode = String(attributes.positionMode ?? '').toUpperCase();
  return (
    (source === 'modelled' || source === 'modeled' || mode === 'SGP4_PROPAGATED') &&
    attributes.imagingClaim === false &&
    attributes.taskingClaim === false
  );
}

export function classifySatelliteLod(
  cameraHeightM: number,
  options: SatelliteLodOptions = {},
): SatelliteLodTier {
  const detailMax = options.detailMaxHeightM ?? SATELLITE_LOD_HEIGHTS_M.detail;
  const labelMax = options.labelMaxHeightM ?? SATELLITE_LOD_HEIGHTS_M.label;
  const pointMax = options.pointMaxHeightM ?? SATELLITE_LOD_HEIGHTS_M.point;
  const height = finite(cameraHeightM);
  if (height == null || height < 0) return 'hidden';
  if (height <= detailMax) return 'detail';
  if (height <= labelMax) return 'label';
  if (height <= pointMax) return 'point';
  return 'hidden';
}

function featureForSatellite(satellite: SpatialSatelliteObservation): SatelliteGeoJsonPointFeature {
  return {
    type: 'Feature',
    geometry: {
      type: 'Point',
      coordinates: [satellite.longitude, satellite.latitude],
    },
    properties: {
      id: satellite.id,
      entityType: 'satellite',
      name: String(satellite.attributes.name ?? satellite.id),
      noradCatalogId: satellite.attributes.noradCatalogId ?? null,
      positionMode: 'SGP4_PROPAGATED',
      positionSource: 'modelled',
      telemetryLive: false,
      imagingClaim: false,
      taskingClaim: false,
      nonImagingSemantics: true,
      freshnessClass: satellite.quality?.freshnessClass ?? 'MODELLED',
      observedAt: satellite.observedAt ?? null,
      receivedAt: satellite.receivedAt,
      caption: SATELLITE_MODELLED_CAPTION,
    },
  };
}

function budgetFor(options: SatelliteLodOptions): SatelliteLodBudget {
  return {
    maxPoints: Math.max(0, Math.floor(options.budget?.maxPoints ?? DEFAULT_SATELLITE_LOD_BUDGET.maxPoints)),
    maxLabels: Math.max(0, Math.floor(options.budget?.maxLabels ?? DEFAULT_SATELLITE_LOD_BUDGET.maxLabels)),
    maxDetails: Math.max(0, Math.floor(options.budget?.maxDetails ?? DEFAULT_SATELLITE_LOD_BUDGET.maxDetails)),
  };
}

export function selectSatellitesForLod(
  satellites: SpatialSatelliteObservation[],
  cameraHeightM: number,
  options: SatelliteLodOptions = {},
): SatelliteLodItem[] {
  const tier = classifySatelliteLod(cameraHeightM, options);
  if (tier === 'hidden') return [];

  const budget = budgetFor(options);
  const candidates = satellites
    .filter((satellite) => isModelledSatellite(satellite))
    .filter((satellite) => Number.isFinite(satellite.latitude) && Number.isFinite(satellite.longitude))
    .sort((a, b) => {
      const aConfidence = finite(a.observationConfidence) ?? 0;
      const bConfidence = finite(b.observationConfidence) ?? 0;
      if (bConfidence !== aConfidence) return bConfidence - aConfidence;
      return a.id.localeCompare(b.id);
    });

  const cap = tier === 'detail'
    ? budget.maxDetails
    : tier === 'label'
      ? budget.maxLabels
      : budget.maxPoints;

  return candidates.slice(0, cap).map((satellite) => ({
    satellite,
    tier,
    feature: featureForSatellite(satellite),
    caption: SATELLITE_MODELLED_CAPTION,
  }));
}

export function satelliteGeoJson(
  satellite: SpatialSatelliteObservation,
): SatelliteGeoJsonPointFeature | null {
  return isModelledSatellite(satellite) ? featureForSatellite(satellite) : null;
}
