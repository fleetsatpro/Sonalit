/**
 * Push — the idempotent, transactional application of operations a device
 * recorded while it could not reach the server.
 *
 * The whole design turns on one sentence: **the ledger row is claimed inside
 * the same transaction as the business mutation.**
 *
 * The existing `x-idempotency-key` middleware caches a response *after* the
 * handler has run. That is the right shape for a browser double-click, but it
 * leaves a window: two concurrent retries of the same key both find no cached
 * response and both execute. A field device retries precisely when it does not
 * know whether the first attempt landed — a lost ACK on a 2G link is the normal
 * case, not the exotic one — so that window is exactly the one that matters
 * here, and a second execution means a second trip, a second delivery, a second
 * container movement.
 *
 * Claiming first closes it:
 *
 *   BEGIN
 *     INSERT INTO sync_operations (...) ON CONFLICT DO NOTHING   -- claim
 *     if the claim was lost -> read the winner's recorded outcome, return it
 *     else run the handler, record the outcome
 *   COMMIT
 *
 * A concurrent duplicate blocks on the unique index until the first transaction
 * resolves, then either reads the committed outcome (winner succeeded) or wins
 * the claim itself (winner rolled back). Either way the business action happens
 * exactly once. If the handler throws, the claim rolls back with it, so a crash
 * mid-flight leaves nothing to clean up and the next retry is a clean first
 * attempt — never a permanently stuck 'claimed' row.
 *
 * Each operation gets its own transaction. That is what makes partial success
 * real: seven accepted, one duplicate, one conflict and one retryable failure
 * stay ten distinct outcomes instead of collapsing into "the batch failed".
 */

const { withOrg } = require('../utils/orgScopedDb');
const logger = require('../utils/logger');
const handlers = require('./handlers');

/** Outcomes the server can report for a single pushed operation. */
const OUTCOME = Object.freeze({
  ACCEPTED: 'accepted',
  DUPLICATE: 'duplicate',
  REJECTED: 'rejected',
  CONFLICT: 'conflict',
  RETRYABLE: 'retryable',
});

/** Maximum operations accepted in one push. Keeps a batch inside one request budget. */
const MAX_BATCH = 100;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Structural validation of one operation envelope.
 *
 * Deliberately strict about `operation_id` being a UUID: it is the idempotency
 * key and the primary key of the ledger, so a device that mints them loosely
 * would be able to collide with another device's operation.
 */
function validateEnvelope(op) {
  if (!op || typeof op !== 'object') return 'operation must be an object';
  if (typeof op.operation_id !== 'string' || !UUID_RE.test(op.operation_id)) {
    return 'operation_id must be a UUID';
  }
  if (typeof op.type !== 'string' || !op.type) return 'type is required';
  if (!handlers.has(op.type)) return `unknown operation type: ${op.type}`;
  if (op.payload != null && typeof op.payload !== 'object') return 'payload must be an object';
  return null;
}

/**
 * Read a previously recorded outcome and shape it as a push result.
 *
 * A row still in 'claimed' means another request is mid-flight right now (the
 * committed-crash case cannot produce a visible 'claimed' row, because the
 * claim and the work share a transaction). Telling the client "retryable" is
 * the honest answer: it does not yet know the outcome, and it must not assume
 * success.
 */
function outcomeFromLedger(row) {
  if (row.status === 'claimed') {
    return {
      outcome: OUTCOME.RETRYABLE,
      error_code: 'in_flight',
      error_message: 'A previous attempt at this operation is still being processed.',
    };
  }
  if (row.status === 'accepted') {
    return { outcome: OUTCOME.DUPLICATE, result: row.result || null };
  }
  if (row.status === 'conflict') {
    return {
      outcome: OUTCOME.CONFLICT,
      result: row.result || null,
      error_code: row.error_code || 'conflict',
      error_message: row.error_message || 'Conflicting change on the server.',
    };
  }
  return {
    outcome: OUTCOME.REJECTED,
    error_code: row.error_code || 'rejected',
    error_message: row.error_message || 'Operation was not accepted.',
  };
}

/**
 * Apply exactly one operation.
 *
 * @param {object} ctx   { user, deviceId, schemaVersion }
 * @param {object} op    the client envelope
 * @returns {Promise<object>} { operation_id, outcome, ... }
 */
async function applyOperation(ctx, op) {
  const invalid = validateEnvelope(op);
  if (invalid) {
    return {
      operation_id: op && op.operation_id,
      outcome: OUTCOME.REJECTED,
      error_code: 'invalid_operation',
      error_message: invalid,
    };
  }

  const handler = handlers.get(op.type);
  const orgId = ctx.user.org_id;

  try {
    return await withOrg(orgId, async (client) => {
      const claim = await client.query(
        `INSERT INTO sync_operations
           (operation_id, org_id, device_id, user_id, operation_type, entity_type,
            entity_id, payload, status, client_created_at, local_sequence)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'claimed', $9, $10)
         ON CONFLICT (operation_id, org_id) DO NOTHING
         RETURNING operation_id`,
        [
          op.operation_id,
          orgId,
          ctx.deviceId,
          ctx.user.id,
          op.type,
          handler.entityType,
          op.entity_id || null,
          JSON.stringify(op.payload || {}),
          op.client_created_at || null,
          Number.isFinite(op.local_sequence) ? op.local_sequence : null,
        ]
      );

      if (claim.rows.length === 0) {
        const prior = await client.query(
          `SELECT status, result, error_code, error_message
             FROM sync_operations WHERE operation_id = $1 AND org_id = $2`,
          [op.operation_id, orgId]
        );
        // Absent only if RLS hid it, which would mean the key belongs to
        // another org. Treat as rejected rather than leaking its existence.
        if (prior.rows.length === 0) {
          return {
            operation_id: op.operation_id,
            outcome: OUTCOME.REJECTED,
            error_code: 'operation_id_conflict',
            error_message: 'This operation id is already in use.',
          };
        }
        return { operation_id: op.operation_id, ...outcomeFromLedger(prior.rows[0]) };
      }

      // ── Claim won. Everything below shares this transaction with it. ──────
      const res = await handler.apply(client, ctx, op);

      if (res.outcome === OUTCOME.CONFLICT) {
        // The losing local event is preserved verbatim. A conflict must never
        // be resolved by quietly dropping field work.
        await client.query(
          `INSERT INTO sync_conflicts
             (org_id, operation_id, device_id, user_id, entity_type, entity_id,
              expected_revision, actual_revision, local_payload, server_snapshot, reason)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [
            orgId,
            op.operation_id,
            ctx.deviceId,
            ctx.user.id,
            handler.entityType,
            op.entity_id || null,
            res.expected_revision ?? null,
            res.actual_revision ?? null,
            JSON.stringify(op.payload || {}),
            res.server_snapshot ? JSON.stringify(res.server_snapshot) : null,
            res.error_message || 'Conflicting change on the server.',
          ]
        );
      }

      const ledgerStatus =
        res.outcome === OUTCOME.ACCEPTED ? 'accepted'
          : res.outcome === OUTCOME.CONFLICT ? 'conflict'
            : 'rejected';

      await client.query(
        `UPDATE sync_operations
            SET status = $3, result = $4, error_code = $5, error_message = $6,
                entity_id = COALESCE($7, entity_id), server_processed_at = NOW()
          WHERE operation_id = $1 AND org_id = $2`,
        [
          op.operation_id,
          orgId,
          ledgerStatus,
          res.result ? JSON.stringify(res.result) : null,
          res.error_code || null,
          res.error_message || null,
          res.entity_id || null,
        ]
      );

      return {
        operation_id: op.operation_id,
        outcome: res.outcome,
        result: res.result || null,
        entity_id: res.entity_id || op.entity_id || null,
        error_code: res.error_code || null,
        error_message: res.error_message || null,
        server_received_at: new Date().toISOString(),
      };
    });
  } catch (err) {
    // The transaction rolled back, claim included, so the next retry is a clean
    // first attempt. Report retryable rather than rejected: the device must not
    // discard work because the database blinked.
    logger.error(`sync.push operation ${op.operation_id} failed: ${err.message}`);
    return {
      operation_id: op.operation_id,
      outcome: OUTCOME.RETRYABLE,
      error_code: 'server_error',
      error_message: 'The server could not process this operation. It will be retried.',
    };
  }
}

/**
 * Apply a batch, preserving each operation's individual outcome.
 *
 * Sequential on purpose. Operations from one device are causally ordered (a
 * container status change must land after the incident that explains it), and
 * the client sorts them by local_sequence before sending; running them
 * concurrently would throw that ordering away for no meaningful latency win on
 * a link slow enough to have needed an outbox in the first place.
 */
async function applyBatch(ctx, ops) {
  const results = [];
  for (const op of ops) {
    results.push(await applyOperation(ctx, op));
  }
  return results;
}

module.exports = { applyOperation, applyBatch, OUTCOME, MAX_BATCH, validateEnvelope };
