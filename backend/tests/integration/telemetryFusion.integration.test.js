/**
 * Telemetry fusion — the redundancy claim, proven against a real database.
 *
 * The spec's central promise is that losing a source costs confidence, not
 * availability. That is a claim about behaviour under failure, so it is tested
 * by failing sources rather than by reading reconcile().
 *
 * Requires DATABASE_URL.
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const { Pool } = require('pg');
const { fuseAndRecord, haversineKm } = require('../../src/routes/telemetryIngest');

const skip = () => !process.env.DATABASE_URL;
const ORG = 'dddddddd-0000-0000-0000-00000000f001';

let pool;
let db;          // org-scoped query fn shaped like trackingEngine.dbForOrg
let sessionId;

beforeAll(async () => {
  if (skip()) return;
  pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: false });
  db = async (text, params) => {
    const c = await pool.connect();
    try {
      await c.query(`SELECT set_config('app.current_org_id', $1, true)`, [ORG]);
      return await c.query(text, params);
    } finally { c.release(); }
  };
});

afterAll(async () => { if (pool) await pool.end(); });

beforeEach(async () => {
  if (skip()) return;
  const s = await db(
    `INSERT INTO tracking_sessions (org_id, session_token_hash, status, first_location_at)
     VALUES ($1, encode(gen_random_bytes(32),'hex'), 'active', NOW()) RETURNING id`, [ORG]);
  sessionId = s.rows[0].id;
});

/** Insert one observation at a chosen age, as a given source. */
async function observe(source, lat, lng, ageSec = 0, accuracy = 10) {
  const r = await db(
    `INSERT INTO tracking_locations
       (org_id, session_id, source, lat, lng, accuracy_m, device_time, quality, event_id)
     VALUES ($1,$2,$3,$4,$5,$6, NOW() - ($7 || ' seconds')::interval, 'good', gen_random_uuid())
     RETURNING id`,
    [ORG, sessionId, source, lat, lng, accuracy, String(ageSec)]);
  return r.rows[0].id;
}

const maybe = skip() ? test.skip : test;

describe('multi-source fusion', () => {
  maybe('a single source still produces a canonical position', async () => {
    // A journey carried by the driver's phone alone is a real journey. If this
    // required a second source, SecuriSat being absent would break tracking —
    // exactly the dependency the fabric exists to remove.
    await observe('guardian_gps', -1.28, 36.81, 5);
    const out = await fuseAndRecord(db, ORG, { id: sessionId }, Date.now());

    expect(out.chosen.source).toBe('guardian_gps');
    // One source cannot corroborate itself, so certainty stops at 'uncertain'
    // even when the measurement itself is good.
    expect(out.certainty).toBe('uncertain');

    const d = await db(`SELECT * FROM reconciliation_decisions WHERE session_id=$1`, [sessionId]);
    expect(d.rows).toHaveLength(1);
    expect(d.rows[0].chosen_source).toBe('guardian_gps');
    expect(d.rows[0].algorithm_version).toBeTruthy();
  });

  maybe('a fresh higher-priority source wins and corroboration raises certainty', async () => {
    await observe('guardian_gps', -1.2800, 36.8100, 20);
    await observe('securisat_elock', -1.2801, 36.8101, 5);
    const out = await fuseAndRecord(db, ORG, { id: sessionId }, Date.now());

    expect(out.chosen.source).toBe('securisat_elock');
    expect(['confirmed', 'probable']).toContain(out.certainty);

    // The loser is retained as contradicting evidence: a decision that records
    // only its winner cannot be audited, only believed.
    const d = await db(
      `SELECT * FROM reconciliation_decisions WHERE session_id=$1 AND superseded_by IS NULL`,
      [sessionId]);
    expect(d.rows[0].contradicting_evidence.length).toBeGreaterThan(0);
  });

  maybe('THE REDUNDANCY CLAIM: a stale primary loses to a live fallback', async () => {
    // SecuriSat is the intended primary, but a lock that stopped reporting 40
    // minutes ago is not evidence of where the truck is NOW. If priority alone
    // decided, the command centre would show a stale position with a confident
    // label — the precise failure this architecture is meant to prevent.
    await observe('securisat_elock', -1.5000, 36.9000, 2400);   // 40 min old
    await observe('guardian_gps',    -1.2800, 36.8100, 10);     // 10 s old
    const out = await fuseAndRecord(db, ORG, { id: sessionId }, Date.now());

    expect(out.chosen.source).toBe('guardian_gps');
  });

  maybe('losing every other source degrades confidence, not availability', async () => {
    await observe('guardian_gps', -1.28, 36.81, 8);
    const out = await fuseAndRecord(db, ORG, { id: sessionId }, Date.now());

    // Still tracking, still a canonical position, just less corroborated.
    expect(out.chosen).toBeTruthy();
    const sess = await db(
      `SELECT current_lat, current_source, status FROM tracking_sessions WHERE id=$1`, [sessionId]);
    expect(sess.rows[0].current_source).toBe('guardian_gps');
    expect(sess.rows[0].status).toBe('active');
  });
});

describe('conflict detection', () => {
  maybe('sources far apart raise a durable conflict and mark certainty conflicted', async () => {
    // ~25km apart: both fresh, both plausible on their own, irreconcilable
    // together. The system must record the disagreement rather than silently
    // picking a winner and reporting confidence it has not earned.
    await observe('guardian_gps',    -1.2800, 36.8100, 5);
    await observe('securisat_elock', -1.2800, 37.0350, 5);
    const out = await fuseAndRecord(db, ORG, { id: sessionId }, Date.now());

    expect(out.conflict).toBeTruthy();
    expect(out.certainty).toBe('conflicted');

    const c = await db(
      `SELECT * FROM telemetry_conflicts WHERE session_id=$1 AND status='open'`, [sessionId]);
    expect(c.rows).toHaveLength(1);
    expect(c.rows[0].kind).toBe('source_disagreement');
    // Evidence is cited, never copied — the observation stays single-versioned.
    expect(c.rows[0].evidence_location_ids.length).toBe(2);
    expect(Number(c.rows[0].metric_value)).toBeGreaterThan(20);
  });

  maybe('a persistent disagreement stays ONE finding, not one per fix', async () => {
    // An alert that repeats itself into noise gets muted, and a muted alert
    // protects nobody.
    for (let i = 0; i < 3; i++) {
      await observe('guardian_gps',    -1.2800, 36.8100, 5);
      await observe('securisat_elock', -1.2800, 37.0350, 5);
      await fuseAndRecord(db, ORG, { id: sessionId }, Date.now());
    }
    const c = await db(
      `SELECT * FROM telemetry_conflicts WHERE session_id=$1 AND status='open'`, [sessionId]);
    expect(c.rows).toHaveLength(1);
  });

  maybe('agreeing sources raise no conflict', async () => {
    await observe('guardian_gps',    -1.28000, 36.81000, 5);
    await observe('securisat_elock', -1.28020, 36.81020, 5);   // ~30 m
    const out = await fuseAndRecord(db, ORG, { id: sessionId }, Date.now());
    expect(out.conflict).toBeNull();
    expect(out.certainty).not.toBe('conflicted');
  });
});

describe('decision provenance', () => {
  maybe('a revised conclusion supersedes rather than overwrites', async () => {
    await observe('guardian_gps', -1.28, 36.81, 5);
    await fuseAndRecord(db, ORG, { id: sessionId }, Date.now());
    await observe('securisat_elock', -1.2801, 36.8101, 2);
    await fuseAndRecord(db, ORG, { id: sessionId }, Date.now());

    const all = await db(
      `SELECT id, superseded_by FROM reconciliation_decisions WHERE session_id=$1
        ORDER BY generated_at`, [sessionId]);
    expect(all.rows).toHaveLength(2);
    expect(all.rows[0].superseded_by).toBe(all.rows[1].id);   // the older is kept
    expect(all.rows[1].superseded_by).toBeNull();             // and the newer is current
  });
});

describe('haversine', () => {
  test('measures a known distance', () => {
    // Nairobi CBD → JKIA, roughly 14 km.
    const km = haversineKm(-1.2864, 36.8172, -1.3192, 36.9278);
    expect(km).toBeGreaterThan(10);
    expect(km).toBeLessThan(20);
  });
  test('is zero for a point against itself', () => {
    expect(haversineKm(-1.28, 36.81, -1.28, 36.81)).toBeCloseTo(0, 6);
  });
});
