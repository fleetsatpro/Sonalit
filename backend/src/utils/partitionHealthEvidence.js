'use strict';

const MAX_PARTITION_EVIDENCE_AGE_MS = 2 * 60 * 60 * 1000;

/**
 * Classify the latest persisted partition-maintenance evidence without
 * converting null/malformed evidence into a successful check.
 *
 * A reported failure remains degraded even if its timestamp is old: the
 * failed condition is genuine negative evidence until a later passing check
 * is recorded. A passing row is only healthy when its timestamp is valid,
 * not in the future, and within the evidence freshness window.
 */
function classifyPartitionEvidence(row, now = Date.now()) {
  if (!row) {
    return {
      status: 'unknown',
      checked_at: null,
      detail: 'No successful partition-check evidence',
    };
  }

  const parsedDate = row.checked_at == null ? null : new Date(row.checked_at);
  const checked_at = parsedDate && Number.isFinite(parsedDate.getTime())
    ? parsedDate.toISOString()
    : null;

  if (row.partitions_ok === false) {
    return {
      status: 'degraded',
      checked_at,
      detail: 'Partition maintenance reported a failure',
    };
  }

  // Only an explicit boolean true is evidence that maintenance passed.
  // SQL NULL, missing columns, and unexpected driver values are inconclusive.
  if (row.partitions_ok !== true) {
    return {
      status: 'unknown',
      checked_at,
      detail: 'Partition-check result is missing or inconclusive',
    };
  }

  const ageMs = checked_at ? now - new Date(checked_at).getTime() : Infinity;
  if (
    !checked_at
    || !Number.isFinite(ageMs)
    || ageMs < 0
    || ageMs > MAX_PARTITION_EVIDENCE_AGE_MS
  ) {
    return {
      status: 'unknown',
      checked_at,
      detail: 'Partition-check evidence is stale or invalid',
    };
  }

  return {
    status: 'healthy',
    checked_at,
    detail: 'Recent partition check passed',
  };
}

module.exports = { classifyPartitionEvidence };
