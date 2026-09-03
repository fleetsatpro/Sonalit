/**
 * Journey lifecycle — termination policy, idempotency and capability truth.
 *
 * The engine takes its `db` as a parameter, so the whole termination matrix is
 * exercisable against a stub without Postgres. What is being pinned down here
 * is operational: a container delivering must end exactly the journeys it owns
 * and no others, and ending one twice must not double-fire.
 */

const T = require('../src/utils/trackingEngine');

/** Minimal query router — matches on the distinguishing fragment of each SQL. */
function makeDb(state) {
  const calls = [];
  const db = async (sql, params = []) => {
    calls.push({ sql, params });

    if (/UPDATE tracking_session_containers SET delivered_at/.test(sql)) {
      for (const c of state.containers) {
        if (String(c.container_id) === String(params[0]) && c.delivered_at == null) {
          c.delivered_at = new Date().toISOString();
        }
      }
      return { rows: [] };
    }

    if (/FROM tracking_sessions s/.test(sql)) {
      const ids = state.containers
        .filter((c) => String(c.container_id) === String(params[0]))
        .map((c) => c.session_id);
      return { rows: state.sessions.filter((s) => ids.includes(s.id) && params[1].includes(s.status)) };
    }

    if (/COUNT\(\*\)::int AS n FROM tracking_session_containers/.test(sql)) {
      const n = state.containers.filter(
        (c) => String(c.session_id) === String(params[0]) && c.delivered_at == null,
      ).length;
      return { rows: [{ n }] };
    }

    if (/UPDATE tracking_sessions\s+SET status = 'completed'/.test(sql)) {
      const s = state.sessions.find((x) => String(x.id) === String(params[2]));
      if (!s || !params[3].includes(s.status)) return { rows: [] };   // already ended
      s.status = 'completed';
      s.termination_reason = params[0];
      return { rows: [s] };
    }

    if (/SELECT \* FROM tracking_sessions WHERE id/.test(sql)) {
      return { rows: state.sessions.filter((x) => String(x.id) === String(params[0])) };
    }

    if (/FROM tracking_sessions\s+WHERE convoy_id/.test(sql)) {
      return { rows: state.sessions.filter((s) => String(s.convoy_id) === String(params[0])) };
    }

    return { rows: [] };
  };
  db.calls = calls;
  return db;
}

const session = (over = {}) => ({
  id: 's1', org_id: 'org1', status: 'active', qr_code_id: 'q1',
  termination_policy: 'container_delivered', termination_container_id: null,
  trip_id: 't1', convoy_id: null, ...over,
});

describe('onContainerDelivered — termination policy matrix', () => {
  test('container_delivered ends the journey on the first delivery', async () => {
    const state = {
      sessions: [session()],
      containers: [{ session_id: 's1', container_id: 'c1', delivered_at: null }],
    };
    const ended = await T.onContainerDelivered(makeDb(state), 'org1', 'c1');
    expect(ended).toHaveLength(1);
    expect(state.sessions[0].status).toBe('completed');
    expect(state.sessions[0].termination_reason).toBe('CONTAINER_DELIVERED');
  });

  test('all_containers_delivered keeps tracking until the LAST container lands', async () => {
    const state = {
      sessions: [session({ termination_policy: 'all_containers_delivered' })],
      containers: [
        { session_id: 's1', container_id: 'c1', delivered_at: null },
        { session_id: 's1', container_id: 'c2', delivered_at: null },
      ],
    };
    const db = makeDb(state);

    expect(await T.onContainerDelivered(db, 'org1', 'c1')).toHaveLength(0);
    expect(state.sessions[0].status).toBe('active');      // still moving

    expect(await T.onContainerDelivered(db, 'org1', 'c2')).toHaveLength(1);
    expect(state.sessions[0].status).toBe('completed');
  });

  test('specific_container_delivered ignores every container but its own', async () => {
    const state = {
      sessions: [session({
        termination_policy: 'specific_container_delivered', termination_container_id: 'c2',
      })],
      containers: [
        { session_id: 's1', container_id: 'c1', delivered_at: null },
        { session_id: 's1', container_id: 'c2', delivered_at: null },
      ],
    };
    const db = makeDb(state);

    expect(await T.onContainerDelivered(db, 'org1', 'c1')).toHaveLength(0);
    expect(await T.onContainerDelivered(db, 'org1', 'c2')).toHaveLength(1);
  });

  test('convoy_ended sessions are untouched by container delivery', async () => {
    const state = {
      sessions: [session({ termination_policy: 'convoy_ended', convoy_id: 'cv1' })],
      containers: [{ session_id: 's1', container_id: 'c1', delivered_at: null }],
    };
    const ended = await T.onContainerDelivered(makeDb(state), 'org1', 'c1');
    expect(ended).toHaveLength(0);
    expect(state.sessions[0].status).toBe('active');
  });

  test('a null container id is a no-op, not a crash', async () => {
    expect(await T.onContainerDelivered(makeDb({ sessions: [], containers: [] }), 'org1', null))
      .toEqual([]);
  });
});

describe('termination is idempotent', () => {
  test('delivering the same container twice ends the journey once', async () => {
    const state = {
      sessions: [session()],
      containers: [{ session_id: 's1', container_id: 'c1', delivered_at: null }],
    };
    const db = makeDb(state);

    expect(await T.onContainerDelivered(db, 'org1', 'c1')).toHaveLength(1);

    // Second delivery: the session is no longer in a live status, so the
    // candidate query returns nothing and no second TRACKING_TERMINATED fires.
    expect(await T.onContainerDelivered(db, 'org1', 'c1')).toHaveLength(0);

    const terminations = db.calls.filter((c) =>
      /INSERT INTO tracking_events/.test(c.sql) && c.params.includes('TRACKING_TERMINATED'));
    expect(terminations).toHaveLength(1);
  });

  test('terminateSession on an already-completed session returns it without re-ending', async () => {
    const state = { sessions: [session({ status: 'completed' })], containers: [] };
    const db = makeDb(state);
    const row = await T.terminateSession(db, 'org1', 's1', 'MANUAL');
    expect(row.status).toBe('completed');
    expect(row.termination_reason).toBeUndefined();   // untouched by this call
  });
});

describe('onConvoyEnded', () => {
  test('ends convoy_ended sessions and leaves container-governed ones alone', async () => {
    const state = {
      sessions: [
        session({ id: 's1', termination_policy: 'convoy_ended', convoy_id: 'cv1' }),
        session({ id: 's2', termination_policy: 'container_delivered', convoy_id: 'cv1' }),
      ],
      containers: [],
    };
    const ended = await T.onConvoyEnded(makeDb(state), 'org1', 'cv1', 'CONVOY_COMPLETED');
    expect(ended.map((s) => s.id)).toEqual(['s1']);
    expect(state.sessions[1].status).toBe('active');
  });

  test('one vehicle ending does not disturb the others', async () => {
    const state = {
      sessions: [
        session({ id: 's1', termination_policy: 'convoy_ended', convoy_id: 'cv1' }),
        session({ id: 's2', termination_policy: 'convoy_ended', convoy_id: 'cv2' }),
      ],
      containers: [],
    };
    await T.onConvoyEnded(makeDb(state), 'org1', 'cv1', 'CONVOY_COMPLETED');
    expect(state.sessions[0].status).toBe('completed');
    expect(state.sessions[1].status).toBe('active');
  });
});
