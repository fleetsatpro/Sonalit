import { describe, expect, it } from 'vitest';
import {
  ageLabel,
  freshnessLabel,
  getLiveFeedState,
  hasValidCoordinates,
  isValidLiveTripPayload,
} from './liveOperationsEvidence.js';

const NOW = Date.parse('2026-10-23T12:00:00.000Z');

describe('CDS live-operation evidence', () => {
  describe('coordinate validation', () => {
    it('accepts finite coordinates within geographic bounds', () => {
      expect(hasValidCoordinates({ lat: -1.2864, lng: 36.8172 })).toBe(true);
      expect(hasValidCoordinates({ lat: 90, lng: 180 })).toBe(true);
      expect(hasValidCoordinates({ lat: 0, lng: 36.8172 })).toBe(true);
    });

    it('rejects missing, non-finite, or out-of-range coordinates', () => {
      expect(hasValidCoordinates({ lat: null, lng: 36.8 })).toBe(false);
      expect(hasValidCoordinates({ lat: Number.NaN, lng: 36.8 })).toBe(false);
      expect(hasValidCoordinates({ lat: 1, lng: Number.POSITIVE_INFINITY })).toBe(false);
      expect(hasValidCoordinates({ lat: 91, lng: 36.8 })).toBe(false);
      expect(hasValidCoordinates({ lat: 1, lng: -181 })).toBe(false);
      expect(hasValidCoordinates({ lat: 0, lng: 0 })).toBe(false);
      expect(hasValidCoordinates({ lat: 0.0000002, lng: -0.0000002 })).toBe(false);
    });
  });

  describe('runtime feed contract', () => {
    const validPayload = {
      data: [{
        id: 't1',
        status: 'dispatched',
        phase: 'moving',
        trip_number: 'CDS-1001',
        origin: 'Nairobi',
        destination: 'Mombasa',
        eta: null,
        vehicle_reg: 'KDA 101X',
        lat: -1.2864,
        lng: 36.8172,
        last_seen: '2026-10-23T11:59:00.000Z',
        position_is_live: false,
        tracking_health: 'live',
        position_source: 'device_telematics',
      }],
    };

    it('requires an array envelope and numeric-or-null coordinates', () => {
      expect(isValidLiveTripPayload(validPayload)).toBe(true);
      expect(isValidLiveTripPayload({ data: { trips: [] } })).toBe(false);
      expect(isValidLiveTripPayload({ data: [{ ...validPayload.data[0], lat: '-1.2864' }] })).toBe(false);
      expect(isValidLiveTripPayload({ data: [{ ...validPayload.data[0], lng: undefined }] })).toBe(false);
    });
  });

  describe('tracking freshness labels', () => {
    it('prioritizes a backend-confirmed live fix', () => {
      expect(freshnessLabel({
        position_is_live: true,
        tracking_health: 'stale_fix',
        last_seen: '2026-10-23T11:59:00.000Z',
      })).toBe('LIVE FIX');
    });

    it('uses backend tracking health or clearly identifies last-known/no-fix states', () => {
      expect(freshnessLabel({
        position_is_live: false,
        tracking_health: 'stale_fix',
        last_seen: '2026-10-23T11:00:00.000Z',
      })).toBe('STALE FIX');
      expect(freshnessLabel({
        position_is_live: false,
        tracking_health: null,
        last_seen: '2026-10-23T11:00:00.000Z',
      })).toBe('LAST KNOWN');
      expect(freshnessLabel({
        position_is_live: false,
        tracking_health: null,
        last_seen: null,
      })).toBe('NO FIX');
      expect(freshnessLabel({
        position_is_live: false,
        tracking_health: 'live',
        last_seen: '2026-10-23T11:59:00.000Z',
      })).toBe('LAST KNOWN');
    });
  });

  describe('event age labels', () => {
    it('does not invent an age for missing or malformed timestamps', () => {
      expect(ageLabel(null, NOW)).toBe('Timestamp unavailable');
      expect(ageLabel('not-a-time', NOW)).toBe('Timestamp invalid');
    });

    it('renders recent and older timestamps from the supplied clock', () => {
      expect(ageLabel(new Date(NOW - 12_000).toISOString(), NOW)).toBe('12s ago');
      expect(ageLabel(new Date(NOW - 90_000).toISOString(), NOW)).toBe('1m ago');
      expect(ageLabel(new Date(NOW - 2 * 3_600_000).toISOString(), NOW)).toBe('2h ago');
    });

    it('does not call a materially future timestamp current', () => {
      expect(ageLabel(new Date(NOW + 60_000).toISOString(), NOW)).toBe('Timestamp in future');
      expect(ageLabel(new Date(NOW + 10_000).toISOString(), NOW)).toBe('just now');
    });
  });

  describe('feed state', () => {
    it('distinguishes first-load, unavailable, degraded, current and stale evidence', () => {
      expect(getLiveFeedState({
        isPending: true, isError: false, hasData: false, dataUpdatedAt: 0,
      }, NOW)).toBe('CHECKING FEED');

      expect(getLiveFeedState({
        isPending: false, isError: true, hasData: false, dataUpdatedAt: 0,
      }, NOW)).toBe('FEED UNAVAILABLE');

      expect(getLiveFeedState({
        isPending: false, isError: true, hasData: true, dataUpdatedAt: NOW - 5_000,
      }, NOW)).toBe('FEED DEGRADED');

      expect(getLiveFeedState({
        isPending: false, isError: false, hasData: true, dataUpdatedAt: NOW - 45_000,
      }, NOW)).toBe('FEED CURRENT');

      expect(getLiveFeedState({
        isPending: false, isError: false, hasData: true, dataUpdatedAt: NOW - 45_001,
      }, NOW)).toBe('FEED STALE');

      expect(getLiveFeedState({
        isPending: false, isError: false, hasData: true, dataUpdatedAt: NOW + 60_000,
      }, NOW)).toBe('FEED STALE');
    });
  });
});
