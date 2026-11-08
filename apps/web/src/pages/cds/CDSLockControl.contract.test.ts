import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (name: string) => readFileSync(new URL(name, import.meta.url), 'utf8');
const pages = read('./pages.tsx');
const hooks = read('./hooks.ts');
const polish = read('./CDSOperationalPolish.css');
const apiRoutes = read('../../../../../backend/src/routes/cds.js');
const lockStart = pages.indexOf('const LOCK_HEARTBEAT_STALE_MS');
const lockEnd = pages.indexOf('export function PortView()', lockStart);
const lockConsole = pages.slice(lockStart, lockEnd);

describe('CDS E-Lock Control contract', () => {
  it('uses the persisted device fields instead of stale frontend aliases', () => {
    for (const field of ['reported_battery_level', 'reported_battery_at', 'reported_signal_strength', 'reported_signal_at', 'reported_tamper_detected', 'reported_tamper_at', 'last_heartbeat_event_at', 'reported_solar_charging', 'reported_solar_at', 'reported_temperature', 'reported_temperature_at', 'firmware_version']) {
      expect(lockConsole).toContain(field);
    }
    expect(lockConsole).toContain('battery_level');
    expect(lockConsole).toContain('REGISTERED · UNVERIFIED');
    expect(lockConsole).not.toContain("row['last_heartbeat']");
    expect(lockConsole).not.toContain("row['signal_strength']");
    expect(lockConsole).toContain('battery === null');
    expect(lockConsole).toContain('age > LOCK_HEARTBEAT_STALE_MS');
    expect(lockConsole).toContain('function lockTelemetryFresh');
    expect(lockConsole).toContain('LAST REPORT ');
    expect(lockConsole).toContain('LOCK_HEARTBEAT_STALE_MS = 15 * 60 * 1000');
    expect(lockConsole).toContain('BatteryCharging');
    expect(lockConsole).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  it('derives current device telemetry from tenant-scoped persisted events, not database defaults', () => {
    expect(apiRoutes).toContain('LEFT JOIN LATERAL');
    expect(apiRoutes).toContain('le.org_id=t.org_id');
    expect(apiRoutes).toContain("le.type='heartbeat'");
    expect(apiRoutes).toContain('AS last_heartbeat_event_at');
    expect(apiRoutes).toContain('AS reported_battery_level');
    expect(apiRoutes).toContain('AS reported_battery_at');
    expect(apiRoutes).toContain('AS reported_signal_strength');
    expect(apiRoutes).toContain('AS reported_signal_at');
    expect(apiRoutes).toContain('AS reported_solar_charging');
    expect(apiRoutes).toContain('AS reported_solar_at');
    expect(apiRoutes).toContain('AS reported_temperature');
    expect(apiRoutes).toContain('AS reported_temperature_at');
    expect(apiRoutes).toContain('AS reported_tamper_detected');
    expect(apiRoutes).toContain('AS reported_tamper_at');
  });

  it('loads event history from the scoped CDS device endpoint', () => {
    expect(lockConsole).toContain('useLockEvents(lockId, 16)');
    expect(hooks).toContain('/locks/${encodeURIComponent(lockId)}/events');
    expect(hooks).toContain('params: { limit }');
  });

  it('does not simulate hardware actuation that the current CDS API does not expose', () => {
    expect(lockConsole).toContain('Remote lock / unlock actuation is not exposed');
    expect(lockConsole).not.toContain('Ping device');
    expect(lockConsole).not.toContain('UNLOCK DEVICE');
  });

  it('animates the solar-charging battery indicator without defeating reduced motion', () => {
    expect(polish).toContain('.cds-lock-battery--charging .cds-lock-battery__icon svg');
    expect(polish).toContain('@keyframes cds-lock-battery-charge');
    expect(polish).toContain('@media (prefers-reduced-motion: reduce)');
  });
});
