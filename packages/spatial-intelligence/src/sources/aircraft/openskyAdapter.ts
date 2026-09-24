/**
 * OpenSky Network aircraft adapter — normalization only.
 * HTTP runs in backend openskyGateway (server secrets).
 */

import {
  type SpatialObservation,
  classifyFreshness,
  buildQuality,
  isValidLatLon,
} from '../../model/observation.js';
import type {
  WorldSignalProvider,
  ProviderQuery,
  ProviderResult,
  ProviderHealth,
} from '../providerContract.js';

export interface OpenSkyStateVector {
  icao24: string;
  callsign: string | null;
  origin_country: string | null;
  time_position: number | null;
  last_contact: number | null;
  longitude: number | null;
  latitude: number | null;
  baro_altitude: number | null;
  on_ground: boolean | null;
  velocity: number | null;
  true_track: number | null;
  vertical_rate: number | null;
  geo_altitude: number | null;
  squawk: string | null;
  spi: boolean | null;
  position_source: number | null;
}

const PROVIDER_ID = 'opensky';
const DISPLAY_NAME = 'OpenSky Network';
const MAX_LIVE_MS = 45_000;
const MAX_DELAYED_MS = 180_000;

function unixToIso(sec: number | null | undefined): string | null {
  if (sec == null || !Number.isFinite(sec) || sec <= 0 || sec > 4e9) return null;
  return new Date(sec * 1000).toISOString();
}

export function normalizeOpenSkyState(
  row: OpenSkyStateVector,
  receivedAt: string,
): SpatialObservation | null {
  if (!isValidLatLon(row.latitude, row.longitude)) return null;

  const observedAt =
    unixToIso(row.time_position) ?? unixToIso(row.last_contact) ?? null;

  const freshnessClass = observedAt
    ? classifyFreshness(observedAt, receivedAt, {
        maxLiveMs: MAX_LIVE_MS,
        maxDelayedMs: MAX_DELAYED_MS,
      })
    : 'UNKNOWN';

  const quality = buildQuality(freshnessClass, {
    reason: observedAt ? undefined : 'missing source timestamp',
  });

  const callsign = row.callsign?.trim() || null;

  return {
    id: `opensky:${row.icao24}`,
    entityType: 'aircraft',
    source: PROVIDER_ID,
    sourceReference: row.icao24,
    latitude: row.latitude as number,
    longitude: row.longitude as number,
    altitudeM:
      row.geo_altitude != null && Number.isFinite(row.geo_altitude)
        ? row.geo_altitude
        : row.baro_altitude != null && Number.isFinite(row.baro_altitude)
          ? row.baro_altitude
          : null,
    observedAt: observedAt ?? receivedAt,
    receivedAt,
    freshnessMs: observedAt
      ? Math.max(0, Date.parse(receivedAt) - Date.parse(observedAt))
      : undefined,
    accuracyM: null,
    confidence: observedAt ? 0.85 : 0.4,
    headingDeg:
      row.true_track != null && Number.isFinite(row.true_track)
        ? row.true_track
        : null,
    speedMps:
      row.velocity != null && Number.isFinite(row.velocity) ? row.velocity : null,
    status: row.on_ground ? 'on_ground' : 'airborne',
    attributes: {
      icao24: row.icao24,
      callsign,
      origin_country: row.origin_country,
      baro_altitude: row.baro_altitude,
      geo_altitude: row.geo_altitude,
      vertical_rate: row.vertical_rate,
      squawk: row.squawk,
      on_ground: row.on_ground,
      position_source: row.position_source,
    },
    provenance: {
      sourceName: DISPLAY_NAME,
      sourceUrl: 'https://opensky-network.org/',
      license: 'OpenSky Network terms',
      attribution: 'OpenSky Network',
      observationType: 'adsb_state_vector',
      sourceReference: row.icao24,
    },
    coverage: { complete: false, bounded: true, queryScope: 'bbox' },
    quality,
  };
}

export function normalizeOpenSkyBatch(
  states: OpenSkyStateVector[],
  receivedAt: string,
  queryScope: string,
): { observations: SpatialObservation[]; accepted: number; rejected: number } {
  const observations: SpatialObservation[] = [];
  let rejected = 0;
  for (const row of states) {
    const obs = normalizeOpenSkyState(row, receivedAt);
    if (obs) {
      if (obs.coverage) obs.coverage.queryScope = queryScope;
      observations.push(obs);
    } else {
      rejected++;
    }
  }
  return { observations, accepted: observations.length, rejected };
}

export function createOpenSkyProvider(opts: {
  fetchStates: (query: ProviderQuery) => Promise<OpenSkyStateVector[]>;
}): WorldSignalProvider {
  let lastHealth: ProviderHealth = {
    providerId: PROVIDER_ID,
    status: 'UNKNOWN',
  };

  return {
    id: PROVIDER_ID,
    displayName: DISPLAY_NAME,
    entityTypes: ['aircraft'],
    requiresAuth: false,
    maxLiveMs: MAX_LIVE_MS,

    async fetch(query: ProviderQuery): Promise<ProviderResult> {
      const receivedAt = new Date().toISOString();
      lastHealth = { ...lastHealth, lastAttemptAt: receivedAt };
      try {
        const states = await opts.fetchStates(query);
        const scope = `bbox:${query.bounds.bbox.join(',')}`;
        const { observations, accepted, rejected } = normalizeOpenSkyBatch(
          states, receivedAt, scope,
        );
        const status =
          observations.length === 0
            ? 'UNAVAILABLE'
            : observations.some((o) => o.quality.freshnessClass === 'LIVE')
              ? 'LIVE'
              : observations.some((o) => o.quality.freshnessClass === 'DELAYED')
                ? 'DELAYED'
                : 'STALE';
        lastHealth = {
          providerId: PROVIDER_ID,
          status,
          lastSuccessAt: receivedAt,
          lastAttemptAt: receivedAt,
          recordCount: states.length,
          acceptedCount: accepted,
          rejectedCount: rejected,
        };
        return {
          observations,
          health: lastHealth,
          coverage: { complete: false, omittedCount: rejected, queryScope: scope },
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        lastHealth = {
          providerId: PROVIDER_ID,
          status: 'UNAVAILABLE',
          lastAttemptAt: receivedAt,
          lastErrorClass: 'unknown',
          lastErrorMessage: message,
        };
        return {
          observations: [],
          health: lastHealth,
          coverage: {
            complete: false,
            queryScope: `bbox:${query.bounds.bbox.join(',')}`,
          },
        };
      }
    },

    getHealth() {
      return { ...lastHealth };
    },
  };
}
