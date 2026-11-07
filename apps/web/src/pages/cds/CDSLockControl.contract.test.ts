import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (name: string) => readFileSync(new URL(name, import.meta.url), 'utf8');
const pages = read('./pages.tsx');
const hooks = read('./hooks.ts');
const polish = read('./CDSOperationalPolish.css');
const lockStart = pages.indexOf('const LOCK_HEARTBEAT_STALE_MS');
const lockEnd = pages.indexOf('export function PortView()', lockStart);
const lockConsole = pages.slice(lockStart, lockEnd);

describe('CDS E-Lock Control contract', () => {
  it('uses the persisted device fields instead of stale frontend aliases', () => {
    for (const field of ['battery_level', 'signal_strength', 'tamper_detected', 'last_heartbeat', 'solar_charging', 'firmware_version', 'temperature']) {
      expect(lockConsole).toContain(field);
    }
    expect(lockConsole).toContain('battery === null');
    expect(lockConsole).toContain('age > LOCK_HEARTBEAT_STALE_MS');
    expect(lockConsole).toContain('LOCK_HEARTBEAT_STALE_MS = 15 * 60 * 1000');
    expect(lockConsole).toContain('BatteryCharging');
    expect(lockConsole).not.toMatch(/\p{Extended_Pictographic}/u);
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
