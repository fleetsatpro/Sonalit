import type { SpatialObservation } from './observation.js';

export interface SpatialSatelliteTle {
  line1: string;
  line2: string;
}

export interface SpatialSatelliteOrbit {
  meanMotionRevPerDay?: number | null;
  eccentricity?: number | null;
  inclinationDeg?: number | null;
  raanDeg?: number | null;
  argumentOfPerigeeDeg?: number | null;
  meanAnomalyDeg?: number | null;
  bstar?: number | null;
  epoch: string;
}

export interface SpatialSatellite {
  id: string;
  entityType: 'satellite';
  source: string;
  sourceReference: string;
  name: string;
  noradCatalogId: number;
  objectId?: string | null;
  group: string;
  tle?: SpatialSatelliteTle | null;
  orbit: SpatialSatelliteOrbit;
  propagatorAvailable: boolean;
  imagingClaim: false;
  taskingClaim: false;
  nonImagingSemantics: true;
  provenance: SpatialObservation['provenance'];
  uncertainty: string[];
}

export interface SpatialSatelliteObservation extends SpatialObservation {
  entityType: 'satellite';
  attributes: SpatialSatellite & {
    positionMode: 'SGP4_PROPAGATED';
  };
}
