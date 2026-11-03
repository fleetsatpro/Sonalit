import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('offline capability flag honesty contract', () => {
  it('does not expose a flag for a feature without a tile-cache implementation', () => {
    const flags = source('../../lib/offline/flags.ts');
    expect(flags).not.toContain("'OFFLINE_MAPS'");
    expect(flags).not.toContain('OFFLINE_MAPS: false');
    expect(flags).not.toContain("'OFFLINE_QR'");
    expect(flags).not.toContain("'OFFLINE_CDS'");
    expect(flags).toContain("'OFFLINE_GPS'");
  });

  it('does not expose QR/CDS flags without active consumers', () => {
    const flags = source('../../lib/offline/flags.ts');
    expect(flags).not.toContain('OFFLINE_QR: false');
    expect(flags).not.toContain('OFFLINE_CDS: false');
  });

  it('tells the operator explicitly that offline map tiles are not guaranteed', () => {
    const syncCenter = source('./SyncCenter.tsx');
    expect(syncCenter).toContain('Offline maps unavailable');
    expect(syncCenter).toContain('does not provide a guaranteed local map-tile cache');
    expect(syncCenter).toContain('provider licensing');
  });
});
