import { describe, expect, it } from 'vitest';
import { assessIntelFabricHealth } from './intelligenceFabricHealth.js';
const now = Date.parse('2026-10-09T09:00:00.000Z');
const successSource = {
  active: true,
  health: { status: 'success', error_count: 0, started_at: '2026-10-09T08:55:00.000Z', finished_at: '2026-10-09T08:56:00.000Z' },
};
describe('Intel Hub collection-health semantics', () => {
  it('never turns a failed request with no data into a zero-event or healthy state', () => {
    const result = assessIntelFabricHealth([
      { label: 'Events', isError: true, isPending: false, data: undefined },
      { label: 'Sources', isError: false, isPending: false, data: [] },
    ], [successSource], now);
    expect(result.label).toBe('REQUEST FAILED');
    expect(result.failedQueries).toEqual(['Events']);
    expect(result.detail).toContain('empty results must not be treated as an incident-free situation');
  });
  it('does not count a registered source with no collection run as healthy', () => {
    const result = assessIntelFabricHealth([{ label: 'Events', isError: false, isPending: false, data: [] }], [{ active: true, health: null }], now);
    expect(result.label).toBe('UNKNOWN');
    expect(result.healthySources).toBe(0);
    expect(result.unknownSources).toBe(1);
  });
  it('reports a recent successful collection run as responding rather than live telemetry', () => {
    const result = assessIntelFabricHealth([{ label: 'Events', isError: false, isPending: false, data: [] }], [successSource], now);
    expect(result.label).toBe('RESPONDING');
    expect(result.healthySources).toBe(1);
    expect(result.lastSuccessAt).toBe('2026-10-09T08:56:00.000Z');
    expect(result.detail).toContain('not proof that no incidents occurred');
  });
  it('marks provider failures as degraded even when older observations exist', () => {
    const result = assessIntelFabricHealth([], [
      { active: true, health: { status: 'failed', error_count: 1, error_message: 'HTTP 429', finished_at: '2026-10-09T08:58:00.000Z' }, metrics: { latest_observation: '2026-10-09T08:00:00.000Z' } },
    ], now);
    expect(result.label).toBe('DEGRADED');
    expect(result.healthySources).toBe(0);
    expect(result.failedSources).toBe(1);
  });
  it('marks old success as stale instead of green', () => {
    const result = assessIntelFabricHealth([{ label: 'Events', isError: false, isPending: false, data: [] }], [
      { active: true, health: { status: 'success', error_count: 0, finished_at: '2026-10-07T08:00:00.000Z' } },
    ], now);
    expect(result.label).toBe('STALE');
    expect(result.staleSources).toBe(1);
  });
  it('distinguishes an in-flight request from a healthy source state', () => {
    const result = assessIntelFabricHealth([{ label: 'Events', isError: false, isPending: true, data: undefined }], [successSource], now);
    expect(result.label).toBe('CHECKING');
  });
});
