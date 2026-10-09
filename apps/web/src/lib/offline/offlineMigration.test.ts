import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import { classifyOfflineRow, createOfflineQuarantineRecord } from './offlineMigration.js';

const dbSource = readFileSync(new URL('./db.ts', import.meta.url), 'utf8');

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

  it('runs an additive v4 IndexedDB upgrade and quarantines before deleting source rows', () => {
    expect(dbSource).toContain('this.version(4).stores');
    expect(dbSource).toContain("offline_quarantine: 'id, source, ownerUserId, ownerOrgId, quarantinedAt, reasonCode'");
    expect(dbSource).toContain("moveUnscopedRows('outbox'");
    expect(dbSource).toContain("moveUnscopedRows('gps_buffer'");
    expect(dbSource).toContain("moveUnscopedRows('conflicts'");
    expect(dbSource).toContain("moveUnscopedRows('entities'");
    expect(dbSource).toMatch(/await quarantine\\.put\\(quarantineRecord\\);[\\s\\S]{0,180}await table\\.delete\\(/);
    expect(dbSource).toContain('Do not infer the missing organisation from the current login');
  });
});
