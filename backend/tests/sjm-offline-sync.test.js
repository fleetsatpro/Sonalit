'use strict';

const handlers = require('../src/sync/handlers');

const operation = handlers.get('sjm.field_event.create');
const ORG_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const JOURNEY_ID = '33333333-3333-4333-8333-333333333333';

function setup({ status = 'in_progress', roles = ['cpo'] } = {}) {
  const calls = [];
  const event = {
    id: '44444444-4444-4444-8444-444444444444',
    event_type: 'security_check_in',
    summary: 'Security team check-in recorded',
    source: 'operator',
    created_at: '2026-10-31T00:00:00.000Z',
  };
  const client = {
    async query(sql, params = []) {
      const statement = sql.replace(/\s+/g, ' ').trim();
      calls.push({ statement, params });
      if (statement.startsWith('SELECT id, status FROM sjm_journeys')) {
        return { rows: status ? [{ id: JOURNEY_ID, status }] : [] };
      }
      if (statement.startsWith('SELECT duty_role FROM sjm_journey_participants')) {
        return { rows: roles.map(duty_role => ({ duty_role })) };
      }
      if (statement.startsWith('INSERT INTO sjm_journey_events')) {
        return { rows: [event] };
      }
      throw new Error('Unexpected SQL: ' + statement);
    },
  };
  return { client, calls, event };
}

function makeOperation(overrides = {}) {
  return {
    operation_id: '55555555-5555-4555-8555-555555555555',
    type: 'sjm.field_event.create',
    owner_user_id: USER_ID,
    owner_org_id: ORG_ID,
    entity_id: JOURNEY_ID,
    client_created_at: '2026-10-31T00:05:00.000Z',
    payload: { event_type: 'security_check_in', note: null },
    ...overrides,
  };
}

const CTX = {
  user: { id: USER_ID, org_id: ORG_ID, role: 'analyst' },
  deviceId: 'field-device-1',
};

describe('SJM offline field-event handler', () => {
  test('accepts a role-permitted append-only observation and preserves provenance', async () => {
    const { client, calls } = setup({ roles: ['cpo'] });
    const result = await operation.apply(client, CTX, makeOperation());
    expect(result.outcome).toBe(handlers.OUTCOME.ACCEPTED);
    expect(result.entity_id).toBe(JOURNEY_ID);
    const insert = calls.find(call => call.statement.startsWith('INSERT INTO sjm_journey_events'));
    expect(insert).toBeDefined();
    expect(insert.params[0]).toBe(ORG_ID);
    expect(insert.params[2]).toBe(USER_ID);
    expect(insert.params[5]).toContain('"ingest_transport":"offline_sync"');
    expect(insert.params[5]).toContain('"device_id":"field-device-1"');
    expect(insert.params[5]).toContain('"client_observed_at":"2026-10-31T00:05:00.000Z"');
    expect(insert.params[5]).toContain('"evidence_class":"OPERATOR_REPORTED_NOT_AUTOMATIC_GPS_PROOF"');
  });

  test('rejects queued work whose original user or organisation differs from the authenticated sync identity', async () => {
    const first = setup({ roles: ['cpo'] });
    const wrongUser = await operation.apply(first.client, CTX, makeOperation({ owner_user_id: 'another-user' }));
    expect(wrongUser.outcome).toBe(handlers.OUTCOME.REJECTED);
    expect(wrongUser.error_code).toBe('operation_identity_mismatch');
    expect(first.calls).toHaveLength(0);

    const second = setup({ roles: ['cpo'] });
    const wrongOrg = await operation.apply(second.client, CTX, makeOperation({ owner_org_id: 'another-org' }));
    expect(wrongOrg.outcome).toBe(handlers.OUTCOME.REJECTED);
    expect(wrongOrg.error_code).toBe('operation_identity_mismatch');
    expect(second.calls).toHaveLength(0);
  });

  test('rechecks active duty and rejects a user removed from the mission', async () => {
    const { client, calls } = setup({ roles: [] });
    const result = await operation.apply(client, CTX, makeOperation());
    expect(result.outcome).toBe(handlers.OUTCOME.REJECTED);
    expect(result.error_code).toBe('not_found');
    expect(calls.some(call => call.statement.startsWith('INSERT INTO sjm_journey_events'))).toBe(false);
  });

  test('rejects an event not permitted by the currently assigned duty', async () => {
    const { client, calls } = setup({ roles: ['driver'] });
    const result = await operation.apply(client, CTX, makeOperation({ payload: { event_type: 'security_concern', note: 'Observed concern' } }));
    expect(result.outcome).toBe(handlers.OUTCOME.REJECTED);
    expect(result.error_code).toBe('forbidden');
    expect(calls.some(call => call.statement.startsWith('INSERT INTO sjm_journey_events'))).toBe(false);
  });

  test('rejects terminal journeys before checking roster or inserting', async () => {
    const { client, calls } = setup({ status: 'closed', roles: ['cpo'] });
    const result = await operation.apply(client, CTX, makeOperation());
    expect(result.error_code).toBe('journey_terminal');
    expect(calls.some(call => call.statement.startsWith('SELECT duty_role'))).toBe(false);
    expect(calls.some(call => call.statement.startsWith('INSERT INTO sjm_journey_events'))).toBe(false);
  });

  test('rejects malformed journey ids without issuing a database query', async () => {
    const { client, calls } = setup();
    const result = await operation.apply(client, CTX, makeOperation({ entity_id: 'not-a-uuid' }));
    expect(result.error_code).toBe('invalid_journey_id');
    expect(calls).toHaveLength(0);
  });

  test('rejects invalid and incomplete issue notes before touching the database', async () => {
    const { client, calls } = setup();
    const short = await operation.apply(client, CTX, makeOperation({ payload: { event_type: 'incident', note: 'bad' } }));
    expect(short.error_code).toBe('note_required');
    const long = await operation.apply(client, CTX, makeOperation({ payload: { event_type: 'delay', note: 'x'.repeat(1201) } }));
    expect(long.error_code).toBe('invalid_note');
    expect(calls).toHaveLength(0);
  });

  test('rejects an unsupported caller-supplied event type', async () => {
    const { client, calls } = setup();
    const result = await operation.apply(client, CTX, makeOperation({ payload: { event_type: 'journey_closed', note: 'closed' } }));
    expect(result.outcome).toBe(handlers.OUTCOME.REJECTED);
    expect(calls).toHaveLength(0);
  });

  test('takes tenant and actor identity only from the authenticated sync context', async () => {
    const { client, calls } = setup();
    await operation.apply(client, CTX, makeOperation({ payload: { event_type: 'security_check_in', note: null, org_id: 'attacker-org' } }));
    const journeyLookup = calls.find(call => call.statement.startsWith('SELECT id, status FROM sjm_journeys'));
    expect(journeyLookup.params).toEqual([JOURNEY_ID, ORG_ID]);
    const participantLookup = calls.find(call => call.statement.startsWith('SELECT duty_role'));
    expect(participantLookup.params).toEqual([ORG_ID, JOURNEY_ID, USER_ID]);
  });
});
