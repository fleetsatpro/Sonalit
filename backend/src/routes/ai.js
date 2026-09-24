const router = require('express').Router();
const aiClient = require('../utils/aiClient');
const { authenticate } = require('../middleware/auth');
const { query } = require('../config/database');
const logger = require('../utils/logger');
const { runDecisionFabric } = require('../services/aiSwarm');

// TEMP: branch has helper module + test; full ai.js wiring pending
// This restore brings the production file back from main-equivalent structure.
// See commit history on feat/spatial-loop02-world-context-tool for module + test.

async function persistCopilotDecision({ orgId, userId, command, result }) {
  if (!orgId) throw new Error('Copilot decision persistence requires an authenticated organisation');
  const decisionRow = await query(
    `INSERT INTO public.copilot_decisions (org_id, user_id, command, decision, risk_level, confidence, answer, result, completed_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW()) RETURNING id`,
    [orgId, userId || null, command, result.decision || 'HUMAN_REVIEW_REQUIRED', result.risk_level || 'HIGH', Number(result.confidence || 0), result.answer || '', JSON.stringify(result)]
  );
  return decisionRow.rows[0].id;
}

router.use(authenticate);
module.exports = router;
