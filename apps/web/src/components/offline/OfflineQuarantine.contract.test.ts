import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('offline quarantine operator contract', () => {
  it('does not put quarantined legacy records back into the active outbox', () => {
    const db = read('../../lib/offline/db.ts');
    const index = read('../../lib/offline/index.ts');
    expect(db).toContain('this.version(4).stores');
    expect(db).toContain("moveUnscopedRows('outbox'");
    expect(db).toContain("moveUnscopedRows('gps_buffer'");
    expect(db).toContain("moveUnscopedRows('conflicts'");
    expect(db).toContain("moveUnscopedRows('entities'");
    expect(index).toContain('quarantinedLocalRecords');
  });

  it('tells operators that ambiguous records are preserved but not replayed', () => {
    const screen = read('./SyncCenter.tsx');
    expect(screen).toContain('Legacy offline records require review');
    expect(screen).toContain('not being replayed');
    expect(screen).toContain('Do not clear this browser storage');
    expect(screen).toContain('status.quarantinedLocalRecords > 0');
  });

  it('requires tenant scope on new conflict records', () => {
    const types = read('../../lib/offline/types.ts');
    const engine = read('../../lib/offline/syncEngine.ts');
    expect(types).toContain('export interface ConflictRecord');
    const start = types.indexOf('export interface ConflictRecord');
    const end = types.indexOf('/** One operation\'s outcome', start);
    const conflictType = types.slice(start, end);
    expect(conflictType).toContain('ownerUserId: string;');
    expect(conflictType).toContain('ownerOrgId: string;');
    expect(engine).toContain('ownerOrgId: entry.ownerOrgId');
  });
});
