/**
 * Portal custody-ledger routes.
 *
 * Client:
 *   GET  /portal/convoy/:convoy_id/custody
 *
 * Operator:
 *   POST /portal/convoy/:convoy_id/custody
 */
const router = require('express').Router();
const { authenticate, authorize } = require('../middleware/auth');
const { attachOrgDb } = require('../utils/orgScopedDb');
const { clientAuth } = require('../middleware/clientAuth');
const { asyncHandler } = require('../middleware/error');
const { query } = require('../config/database');
const crypto = require('crypto');

function checkAccess(client, convoy_id, res) {
  if (!client.convoy_ids.includes(convoy_id)) {
    res.status(403).json({ error: 'Not authorised for this convoy' });
    return false;
  }
  return true;
}

// ── GET custody chain ─────────────────────────────────────────────────────────

router.get('/convoy/:convoy_id/custody', clientAuth, asyncHandler(async (req, res) => {
  if (!checkAccess(req.client, req.params.convoy_id, res)) return;
  const { org_id } = req.client;

  const result = await query(
    `SELECT ce.id AS event_id, ce.seq, ce.kind, ce.location,
            ce.created_at AS timestamp, ce.officer,
            ce.seal_intact, ce.hash, ce.prev_hash
     FROM custody_events ce
     JOIN convoys c ON c.id = ce.convoy_id
    WHERE ce.convoy_id = $1 AND c.org_id = $2
    ORDER BY ce.seq ASC`,
    [req.params.convoy_id, org_id],
  );

  // Verify hash chain client-side safe representation
  const events = result.rows.map((r, i) => {
    const expectedPrevHash = i === 0 ? null : result.rows[i - 1].hash;
    const verified = r.prev_hash === expectedPrevHash;
    return {
      event_id: r.event_id,
      seq: r.seq,
      kind: r.kind,
      location: r.location ?? null,
      timestamp: r.timestamp,
      officer: r.officer ?? null,
      seal_intact: r.seal_intact ?? null,
      hash: r.hash,
      prev_hash: r.prev_hash ?? null,
      verified,
    };
  });

  const chain_valid = events.every(e => e.verified);
  res.json({ data: events, meta: { chain_valid, event_count: events.length } });
}));

// ── POST custody event (operator) ─────────────────────────────────────────────

router.post('/convoy/:convoy_id/custody',
  authenticate, attachOrgDb, authorize('admin', 'dispatcher', 'operator'),
  asyncHandler(async (req, res) => {
    const { kind, location, officer, seal_intact, notes } = req.body;
    if (!kind) return res.status(400).json({ error: 'kind required' });

    const check = await req.db(
      `SELECT id FROM convoys WHERE id = $1 AND org_id = $2 AND deleted_at IS NULL`,
      [req.params.convoy_id, req.user.org_id],
    );
    if (!check.rows.length) return res.status(404).json({ error: 'Convoy not found' });

    const lastRes = await req.db(
      `SELECT hash, seq FROM custody_events WHERE convoy_id = $1 ORDER BY seq DESC LIMIT 1`,
      [req.params.convoy_id],
    );
    const prev_hash = lastRes.rows[0]?.hash ?? null;
    const seq = (lastRes.rows[0]?.seq ?? -1) + 1;

    const payload = JSON.stringify({
      seq, kind, location: location ?? null, officer: officer ?? null,
      seal_intact: seal_intact ?? null, convoy_id: req.params.convoy_id,
      org_id: req.user.org_id, prev_hash,
    });
    const hash = crypto.createHash('sha256').update(payload).digest('hex');

    const result = await req.db(
      `INSERT INTO custody_events
         (org_id, convoy_id, seq, kind, location, officer, seal_intact, hash, prev_hash, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING id AS event_id, seq, kind, location, created_at AS timestamp,
                 officer, seal_intact, hash, prev_hash`,
      [req.user.org_id, req.params.convoy_id, seq, kind,
       location ?? null, officer ?? null, seal_intact ?? null,
       hash, prev_hash, notes ?? null],
    );
    res.status(201).json({ data: { ...result.rows[0], verified: true } });
  }),
);

module.exports = router;
