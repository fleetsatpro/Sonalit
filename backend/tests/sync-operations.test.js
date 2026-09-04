'use strict';

/**
 * The push path's two guarantees, tested against a fake Postgres client:
 *
 *   1. an operation is applied exactly once, no matter how often a device
 *      retries it after a lost ACK; and
 *   2. a conflict is neither applied nor discarded.
 *
 * The fake is deliberately small — it models only the behaviour the ledger
 * actually depends on: a unique key on (operation_id, org_id), an
 * ON CONFLICT DO NOTHING insert that returns nothing when it loses, and the
 * fact that withOrg() rolls the whole thing back if the callback throws.
 */

process.env.JWT_SECRET = 'test-jwt-secret';
process.env.DATABASE_URL = 'postgresql://localhost/test_placeholder';

jest.mock('../src/config/database', () => ({
  query: jest.fn().mockResolvedValue({ rows: [] }),
  pool: { connect: jest.fn(), end: jest.fn() },
  healthCheck: jest.fn().mockResolvedValue(true),
}));

// ── A tiny in-memory stand-in for the sync tables ────────────────────────────

let mockLedger;          // Map<`${operationId}|${orgId}`, row>
let mockConflicts;       // array
let mockContainers;      // Map<id, row>
let mockApplies;         // how many times a business mutation actually ran

function mockReset() {
  mockLedger = new Map();
  mockConflicts = [];
  mockContainers = new Map();
  mockApplies = 0;
}

function mockClient() {
  return {
    async query(text, params = []) {
      const sql = text.replace(/\s+/g, ' ').trim();

      if (/^INSERT INTO sync_operations/i.test(sql)) {
        const [operationId, orgId] = params;
        const key = `${operationId}|${orgId}`;
        if (mockLedger.has(key)) return { rows: [] }; // ON CONFLICT DO NOTHING
        mockLedger.set(key, {
          operation_id: operationId,
          org_id: orgId,
          status: 'claimed',
          result: null,
          error_code: null,
          error_message: null,
        });
        return { rows: [{ operation_id: operationId }] };
      }

      if (/^SELECT status, result, error_code, error_message FROM sync_operations/i.test(sql)) {
        const [operationId, orgId] = params;
        const row = mockLedger.get(`${operationId}|${orgId}`);
        return { rows: row ? [row] : [] };
      }

      if (/^UPDATE sync_operations/i.test(sql)) {
        const [operationId, orgId, status, result, errorCode, errorMessage] = params;
        const row = mockLedger.get(`${operationId}|${orgId}`);
        if (row) {
          row.status = status;
          row.result = result ? JSON.parse(result) : null;
          row.error_code = errorCode;
          row.error_message = errorMessage;
        }
        return { rows: [] };
      }

      if (/^INSERT INTO sync_conflicts/i.test(sql)) {
        mockConflicts.push({ operation_id: params[1], entity_id: params[5], reason: params[10] });
        return { rows: [] };
      }

      if (/FROM cds_containers/i.test(sql) && /^SELECT/i.test(sql)) {
        const row = mockContainers.get(params[0]);
        return { rows: row ? [{ ...row }] : [] };
      }

      if (/^UPDATE cds_containers/i.test(sql)) {
        const [id, status] = params;
        const row = mockContainers.get(id);
        row.status = status;
        row.revision = Number(row.revision) + 1; // the migration's BEFORE trigger
        mockApplies++;
        return { rows: [{ ...row }] };
      }

      throw new Error(`fake client: unhandled SQL: ${sql.slice(0, 90)}`);
    },
  };
}

// withOrg is the transaction boundary: on a thrown callback everything the
// callback did — the ledger claim included — must disappear.
jest.mock('../src/utils/orgScopedDb', () => ({
  withOrg: async (_orgId, fn) => {
    const snapshotLedger = new Map([...mockLedger].map(([k, v]) => [k, { ...v }]));
    const snapshotContainers = new Map([...mockContainers].map(([k, v]) => [k, { ...v }]));
    const snapshotConflicts = [...mockConflicts];
    const snapshotApplies = mockApplies;
    try {
      return await fn(mockClient());
    } catch (err) {
      mockLedger = snapshotLedger;
      mockContainers = snapshotContainers;
      mockConflicts = snapshotConflicts;
      mockApplies = snapshotApplies;
      throw err;
    }
  },
  attachOrgDb: (_req, _res, next) => next(),
}));

const { applyOperation, OUTCOME, validateEnvelope } = require('../src/sync/operations');

const CTX = {
  user: { id: '11111111-1111-4111-8111-111111111111', org_id: 'org-a', role: 'yard_agent', name: 'Ada' },
  deviceId: 'tablet-1',
  schemaVersion: 1,
};

const OP_ID = '22222222-2222-4222-8222-222222222222';

function statusChange(overrides = {}) {
  return {
    operation_id: OP_ID,
    type: 'cds_container.status_change',
    entity_id: 'container-1',
    payload: { status: 'in_transit', expected_revision: 3 },
    client_created_at: '2026-09-03T10:00:00.000Z',
    local_sequence: 1,
    ...overrides,
  };
}

beforeEach(() => {
  mockReset();
  mockContainers.set('container-1', {
    id: 'container-1', number: 'MSKU1234567', status: 'at_port', revision: 3,
  });
});

describe('envelope validation', () => {
  it('requires a UUID operation id, because it is the idempotency key', () => {
    // A loosely-minted id could collide with another device's operation, which
    // would make one device's retry return another's result.
    expect(validateEnvelope({ operation_id: 'op-1', type: 'gps.batch' })).toMatch(/UUID/);
  });

  it('rejects an unknown operation type', () => {
    expect(validateEnvelope({ operation_id: OP_ID, type: 'nope' })).toMatch(/unknown operation/i);
  });

  it('accepts a well-formed envelope', () => {
    expect(validateEnvelope(statusChange())).toBeNull();
  });
});

describe('exactly-once application', () => {
  it('applies the business action on the first push', async () => {
    const res = await applyOperation(CTX, statusChange());
    expect(res.outcome).toBe(OUTCOME.ACCEPTED);
    expect(mockApplies).toBe(1);
    expect(mockContainers.get('container-1').status).toBe('in_transit');
  });

  it('does NOT re-apply on a retry after a lost ACK', async () => {
    // The mandatory scenario: the server accepted the delivery event, the
    // network died before the client heard back, the client retried.
    const first = await applyOperation(CTX, statusChange());
    expect(first.outcome).toBe(OUTCOME.ACCEPTED);

    const retry = await applyOperation(CTX, statusChange());

    expect(retry.outcome).toBe(OUTCOME.DUPLICATE);
    expect(mockApplies).toBe(1);          // the action ran exactly once
    expect(mockContainers.get('container-1').revision).toBe(4); // not bumped twice
    expect(retry.result).toEqual(first.result); // and the original result is returned
  });

  it('returns the original rejection on a retry, rather than re-evaluating it', async () => {
    const bad = statusChange({ payload: { status: 'not_a_status', expected_revision: 3 } });
    const first = await applyOperation(CTX, bad);
    expect(first.outcome).toBe(OUTCOME.REJECTED);

    const retry = await applyOperation(CTX, bad);
    expect(retry.outcome).toBe(OUTCOME.REJECTED);
    expect(retry.error_code).toBe(first.error_code);
    expect(mockApplies).toBe(0);
  });

  it('rejects rather than crashes when the record is invisible to the caller', async () => {
    // RLS hiding a row and the row not existing are indistinguishable here, and
    // both are permanent: retrying cannot make it visible.
    const res = await applyOperation(CTX, statusChange({ entity_id: 'container-missing' }));
    expect(res.outcome).toBe(OUTCOME.REJECTED);
    expect(res.error_code).toBe('not_found');
    expect(mockApplies).toBe(0);
  });

  it('rolls the claim back when the transaction blows up, so a retry is a clean first attempt', async () => {
    // Simulate the database failing mid-operation: the claim, the business
    // mutation and the ledger update share one transaction, so all three must
    // vanish together. A claim that survived would strand the operation as a
    // permanent 'in_flight' that no retry could ever get past.
    mockContainers.delete('container-1');
    Object.defineProperty(mockContainers, 'get', {
      value: () => { throw new Error('connection reset'); },
      configurable: true,
    });

    const failed = await applyOperation(CTX, statusChange());
    expect(failed.outcome).toBe(OUTCOME.RETRYABLE);
    expect(mockLedger.size).toBe(0); // the claim rolled back with everything else

    delete mockContainers.get;
    mockContainers.set('container-1', {
      id: 'container-1', number: 'MSKU1234567', status: 'at_port', revision: 3,
    });

    const retry = await applyOperation(CTX, statusChange());
    expect(retry.outcome).toBe(OUTCOME.ACCEPTED);
    expect(mockApplies).toBe(1);
  });
});

describe('conflict handling', () => {
  it('refuses to overwrite a record that moved on, and preserves the local event', async () => {
    // Another authorised user changed the container while this device was dark.
    mockContainers.get('container-1').revision = 7;

    const res = await applyOperation(CTX, statusChange());

    expect(res.outcome).toBe(OUTCOME.CONFLICT);
    expect(mockApplies).toBe(0);                       // nothing overwritten
    expect(mockContainers.get('container-1').status).toBe('at_port');
    expect(mockConflicts).toHaveLength(1);                     // and nothing lost
    expect(mockConflicts[0].operation_id).toBe(OP_ID);
  });

  it('reports the same conflict on retry instead of applying it', async () => {
    mockContainers.get('container-1').revision = 7;
    await applyOperation(CTX, statusChange());

    const retry = await applyOperation(CTX, statusChange());
    expect(retry.outcome).toBe(OUTCOME.CONFLICT);
    expect(mockApplies).toBe(0);
    expect(mockConflicts).toHaveLength(1); // not recorded twice
  });

  it('requires an expected_revision before it will change shared state', async () => {
    const res = await applyOperation(CTX, statusChange({ payload: { status: 'in_transit' } }));
    expect(res.outcome).toBe(OUTCOME.REJECTED);
    expect(res.error_code).toBe('missing_revision');
  });
});

describe('authorisation', () => {
  it('refuses an operation the role cannot perform, whatever the client claims', async () => {
    const ctx = { ...CTX, user: { ...CTX.user, role: 'analyst' } };
    const res = await applyOperation(ctx, statusChange());
    expect(res.outcome).toBe(OUTCOME.REJECTED);
    expect(res.error_code).toBe('forbidden');
    expect(mockApplies).toBe(0);
  });
});
