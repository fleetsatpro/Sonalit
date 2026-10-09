/**
 * Pure classification helpers for the Dexie v4 tenant-safety migration.
 *
 * Missing tenant ownership is not recoverable from the currently active login:
 * a shared device may have changed organisations since a row was queued. These
 * helpers deliberately never infer ownership from the session or payload.
 */
export type OfflineQuarantineSource = 'entities' | 'outbox' | 'gps_buffer' | 'conflicts';
export type OfflineQuarantineReason = 'missing_tenant_scope' | 'invalid_entity_identity';

export interface OfflineQuarantineRecord {
  id: string;
  source: OfflineQuarantineSource;
  ownerUserId: string | null;
  ownerOrgId: string | null;
  quarantinedAt: number;
  reasonCode: OfflineQuarantineReason;
  record: Record<string, unknown>;
}

export interface OfflineRowClassification {
  quarantine: boolean;
  reasonCode: OfflineQuarantineReason | null;
  ownerUserId: string | null;
  ownerOrgId: string | null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

export function classifyOfflineRow(
  source: OfflineQuarantineSource,
  row: Record<string, unknown>,
): OfflineRowClassification {
  // Entity mirrors use ownerLookup/orgId; queue rows use ownerUserId/ownerOrgId.
  const ownerUserId = nonEmptyString(source === 'entities' ? row.ownerLookup : row.ownerUserId);
  const ownerOrgId = nonEmptyString(source === 'entities' ? row.orgId : row.ownerOrgId);

  if (!ownerUserId || !ownerOrgId) {
    return { quarantine: true, reasonCode: 'missing_tenant_scope', ownerUserId, ownerOrgId };
  }
  if (source === 'entities' && (!nonEmptyString(row.entityType) || !nonEmptyString(row.entityId))) {
    return { quarantine: true, reasonCode: 'invalid_entity_identity', ownerUserId, ownerOrgId };
  }
  return { quarantine: false, reasonCode: null, ownerUserId, ownerOrgId };
}

export function createOfflineQuarantineRecord(
  source: OfflineQuarantineSource,
  primaryKey: unknown,
  row: Record<string, unknown>,
  classification: OfflineRowClassification,
  quarantinedAt: number,
): OfflineQuarantineRecord {
  if (!classification.quarantine || !classification.reasonCode) {
    throw new Error('offline_quarantine_requires_classified_failure');
  }
  const key = typeof primaryKey === 'string' || typeof primaryKey === 'number'
    ? String(primaryKey)
    : 'unknown';
  return {
    id: source + ':' + key,
    source,
    ownerUserId: classification.ownerUserId,
    ownerOrgId: classification.ownerOrgId,
    quarantinedAt,
    reasonCode: classification.reasonCode,
    // Preserve the entire original row. The migration writes this copy before
    // deleting the source row, inside the same IndexedDB upgrade transaction.
    record: { ...row },
  };
}
