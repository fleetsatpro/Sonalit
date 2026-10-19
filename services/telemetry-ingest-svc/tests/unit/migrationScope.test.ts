import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('../../src/db/migrate.ts', import.meta.url), 'utf8');
const launcher = readFileSync(new URL('../../src/start.ts', import.meta.url), 'utf8');
const packageManifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { scripts?: Record<string, string> };

describe('telemetry tenant isolation schema', () => {
  it('uses the migration-gated launcher in production and development', () => {
    expect(packageManifest.scripts?.start).toBe('node dist/start.js');
    expect(packageManifest.scripts?.dev).toBe('tsx watch src/start.ts');
    expect(launcher).toContain('await migrate();');
    expect(launcher).toContain("await import('./index.js')");
  });

  it('treats an absent or empty tenant context as NULL rather than malformed UUID text', () => {
    expect(migration).toContain("NULLIF(current_setting('app.current_org_id', true), '')::uuid");
    expect(migration).not.toContain("'''')");
  });

  it('keeps raw GPS and outbox writes behind tenant row-level security', () => {
    expect(migration).toContain('ALTER TABLE gps_fixes ENABLE ROW LEVEL SECURITY');
    expect(migration).toContain('ALTER TABLE gps_fixes FORCE ROW LEVEL SECURITY');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS telemetry_ingest_outbox');
    expect(migration).toContain('CREATE POLICY telemetry_ingest_outbox_tenant_hardening');
  });

  it('does not estimate distance using a guessed fixed GPS sampling interval', () => {
    expect(migration).not.toContain('0.00833');
    expect(migration).toContain('NULL::double precision AS distance_km');
  });

  it('uses a stable, partition-compatible identity for replay protection', () => {
    expect(migration).toContain('gps_fixes_device_seq_time_uidx');
    expect(migration).toContain('UNIQUE (device_id, seq_no, time)');
  });
});
