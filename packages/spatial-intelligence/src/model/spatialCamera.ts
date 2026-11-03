/**
 * SpatialCamera is a location-aware public observation surface.
 * It describes camera pose, viewshed, media and source health without
 * making person/plate identification claims.
 */
export interface SpatialCameraPose {
  latitude: number;
  longitude: number;
  altitudeM?: number | null;
  headingDeg?: number | null;
  pitchDeg?: number | null;
  rollDeg?: number | null;
  confidence: 'verified' | 'estimated' | 'unknown';
}

export interface SpatialCameraViewshed {
  horizontalFovDeg: number;
  verticalFovDeg?: number | null;
  maxRangeM: number;
  minRangeM?: number;
  polygon?: Array<[number, number]>;
}

export interface SpatialCameraMedia {
  kind: 'image' | 'video' | 'mjpeg' | 'synthetic';
  url?: string | null;
  frameUrl?: string | null;
  available: boolean;
  publicSource: boolean;
}

export interface SpatialCameraHealth {
  status: 'LIVE' | 'DEGRADED' | 'STALE' | 'UNAVAILABLE' | 'UNKNOWN';
  lastSuccessAt?: string | null;
  lastAttemptAt?: string | null;
  reason?: string;
}

export interface SpatialCamera extends SpatialObservationCameraContract {}

export interface SpatialObservationCameraContract {
  id: string;
  entityType: 'camera';
  source: string;
  sourceReference?: string;
  pose: SpatialCameraPose;
  viewshed: SpatialCameraViewshed;
  media: SpatialCameraMedia;
  health: SpatialCameraHealth;
  provenance: {
    sourceName: string;
    sourceUrl?: string;
    license?: string;
    attribution?: string;
    observationType?: string;
    sourceReference?: string;
  };
  privacy: {
    plateTracking: false;
    personTracking: false;
    faceRecognition: false;
  };
}
