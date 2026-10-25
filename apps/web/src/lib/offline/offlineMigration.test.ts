import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import { classifyOfflineRow, createOfflineQuarantineRecord, shouldPurgeOfflineQuarantineRecord } from './offlineMigration.js';

const dbSource = readFileSync(new URL('./db.ts', import.meta.url), 'utf8');
const offlineIndexSource = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');

describe('offline tenant-scope migration', () => {
  it('quarantines a legacy outbox row with no tenant instead of assigning the current tenant', () => {
    const row = {
      id: 'operation-legacy-1', ownerUserId: 'user-a',
      type: 'cds_container.status_change', payload: { status: 'arrived' }, status: 'PENDING',
    };
    expect(classifyOfflineRow('outbox', row)).toMatchObject({
      quarantine: true, reasonCode: 'missing_tenant_scope', ownerUserId: 'user-a', ownerOrgId: null,
    });
  });

  it('keeps already scoped queue and GPS records eligible for normal processing', () => {
    expect(classifyOfflineRow('outbox', {
      id: 'operation-1', ownerUserId: 'user-a', ownerOrgId: 'org-a', status: 'PENDING',
    })).toMatchObject({ quarantine: false, reasonCode: null, ownerUserId: 'user-a', ownerOrgId: 'org-a' });
    expect(classifyOfflineRow('gps_buffer', {
      id: 'fix-1', ownerUserId: 'user-a', ownerOrgId: 'org-a', vehicleId: 'truck-1',
    })).toMatchObject({ quarantine: false, reasonCode: null });
  });

  it('quarantines historical conflicts that cannot be safely attributed to an organisation', () => {
    const classified = classifyOfflineRow('conflicts', {
      id: 'conflict-legacy-1', ownerUserId: 'user-a', entityType: 'cds_container',
      localPayload: { status: 'delivered' }, reason: 'revision mismatch',
    });
    expect(classified).toMatchObject({ quarantine: true, reasonCode: 'missing_tenant_scope', ownerOrgId: null });
  });

  it('quarantines malformed entity mirrors while retaining known owner metadata', () => {
    expect(classifyOfflineRow('entities', {
      key: 'undefined:undefined:undefined', ownerLookup: 'user-a', orgId: 'org-a', data: {},
    })).toMatchObject({ quarantine: true, reasonCode: 'invalid_entity_identity' });
  });

  it('stores an exact raw-record copy with stable key and timestamp', () => {
    const row = { id: 'operation-legacy-2', ownerUserId: 'user-b', status: 'PENDING', payload: { event: 'panic' } };
    const classification = classifyOfflineRow('outbox', row);
    const quarantine = createOfflineQuarantineRecord('outbox', row.id, row, classification, 1234);
    expect(quarantine).toEqual({
      id: 'outbox:operation-legacy-2', source: 'outbox', ownerUserId: 'user-b', ownerOrgId: null,
      quarantinedAt: 1234, reasonCode: 'missing_tenant_scope', record: row,
    });
    expect(() => createOfflineQuarantineRecord('outbox', row.id, row, classifyOfflineRow('outbox', {
      ...row, ownerOrgId: 'org-b',
    }), 1234)).toThrow('offline_quarantine_requires_classified_failure');
  });

  it('purges quarantine rows only for an explicit handover and exact known owner', () => {
    expect(shouldPurgeOfflineQuarantineRecord(
      { ownerUserId: 'user-a' }, 'user-a', false,
    )).toBe(true);
    expect(shouldPurgeOfflineQuarantineRecord(
      { ownerUserId: 'user-a' }, 'user-a', true,
    )).toBe(false);
    expect(shouldPurgeOfflineQuarantineRecord(
      { ownerUserId: 'user-b' }, 'user-a', false,
    )).toBe(false);
    expect(shouldPurgeOfflineQuarantineRecord(
      { ownerUserId: null }, 'user-a', false,
    )).toBe(false);
    expect(shouldPurgeOfflineQuarantineRecord(
      { ownerUserId: 'user-a' }, ' ', false,
    )).toBe(false);
  });

  it('includes quarantine in the purge transaction but deletes it only on explicit data removal', () => {
    const purgeStart = dbSource.indexOf('export async function purgeUserData');
    const purgeEnd = dbSource.indexOf('/** How many operations this user has', purgeStart);
    const purgeSource = dbSource.slice(purgeStart, purgeEnd);

    expect(purgeSource).toContain('db.sync_meta, db.offline_quarantine');
    expect(purgeSource).toContain('shouldPurgeOfflineQuarantineRecord(row, userId, keepUnsyncedOutbox)');
    expect(purgeSource).toContain('counts.quarantined = disposableQuarantine.length');
    expect(purgeSource).toContain('quarantined: number');
    expect(purgeSource).not.toContain('offline_quarantine.clear()');
  });

  it('adds the media queue in schema v5 without replacing the tenant-safe v4 upgrade', () => {
    const v4 = dbSource.indexOf('this.version(4).stores');
    const v4Upgrade = dbSource.indexOf('}).upgrade(async tx => {', v4);
    const moveEntities = dbSource.indexOf("await moveUnscopedRows('entities', 'entities', 'key');", v4Upgrade);
    const v5 = dbSource.indexOf('this.version(5).stores', v4Upgrade);
    expect(v4).toBeGreaterThanOrEqual(0);
    expect(v4Upgrade).toBeGreaterThan(v4);
    expect(moveEntities).toBeGreaterThan(v4Upgrade);
    expect(v5).toBeGreaterThan(moveEntities);
    expect(dbSource).toContain("media_outbox: 'id, kind, ownerUserId, ownerOrgId, [ownerUserId+ownerOrgId]");
    expect(dbSource).toContain('media_outbox!: EntityTable<MediaUploadEntry, \'id\'>');
  });

  it('preserves unresolved GPS, conflicts, media and permanent rejections on logout', () => {
    const start = dbSource.indexOf('export async function purgeUserData');
    const end = dbSource.indexOf('/** How many operations this user has', start);
    const purgeSource = dbSource.slice(start, end);
    const keepBranch = purgeSource.slice(purgeSource.indexOf('if (keepUnsyncedOutbox)'), purgeSource.indexOf('} else {'));
    const fullPurge = purgeSource.slice(purgeSource.indexOf('} else {'));
    expect(keepBranch).toContain("rows.filter(r => r.status === 'ACKNOWLEDGED')");
    expect(keepBranch).not.toContain("r.status === 'FAILED_PERMANENT'");
    expect(keepBranch).not.toContain("where('ownerUserId').equals(userId).delete()");
    expect(fullPurge).toContain("db.gps_buffer.where('ownerUserId').equals(userId).delete()");
    expect(fullPurge).toContain("db.conflicts.where('ownerUserId').equals(userId).delete()");
    expect(fullPurge).toContain("db.media_outbox.where('ownerUserId').equals(userId).delete()");
    expect(fullPurge).toContain('await owned.delete()');
  });

  it('retains only non-secret identity metadata so a later tenant switch can be detected', () => {
    const stopStart = offlineIndexSource.indexOf('export async function stopOffline');
    const stopEnd = offlineIndexSource.indexOf('/** Force a sync now', stopStart);
    const stopSource = offlineIndexSource.slice(stopStart, stopEnd);
    expect(stopSource).toContain("delete('session:userId')");
    expect(stopSource).not.toContain("delete('session:identity')");
    expect(stopSource).toContain('non-secret identity metadata');
    expect(offlineIndexSource).toContain("prev.userId !== id.userId || prev.orgId !== id.orgId");
  });

  it('runs an additive v4 IndexedDB upgrade and quarantines before deleting source rows', () => {
    expect(dbSource).toContain('this.version(4).stores');
    expect(dbSource).toContain("offline_quarantine: 'id, source, ownerUserId, ownerOrgId, quarantinedAt, reasonCode'");
    expect(dbSource).toContain("moveUnscopedRows('outbox'");
    expect(dbSource).toContain("moveUnscopedRows('gps_buffer'");
    expect(dbSource).toContain("moveUnscopedRows('conflicts'");
    expect(dbSource).toContain("moveUnscopedRows('entities'");
    const copyIndex = dbSource.indexOf('await quarantine.put(quarantineRecord);');
    const deleteIndex = dbSource.indexOf('await table.delete(', copyIndex);
    expect(copyIndex).toBeGreaterThanOrEqual(0);
    expect(deleteIndex).toBeGreaterThan(copyIndex);
    expect(dbSource).toContain('An unscoped/malformed row must survive this earlier-version migration');
    expect(dbSource).toContain('Do not infer the missing organisation from the current login');
  });
});
