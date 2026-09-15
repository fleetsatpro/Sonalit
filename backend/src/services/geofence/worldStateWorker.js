'use strict';

const { reconcileWorldState } = require('./worldStateSwarm');

/**
 * Small, bounded coordinator for deferred world-state tasks. This intentionally
 * does not mutate raw tracking evidence. It only records the deterministic
 * reconciliation result so later AI investigation agents have provenance.
 */
async function processOne({ db, taskId, now = Date.now() }) {
  const taskResult = await db(
    `SELECT id, org_id, session_id, task_type, payload
       FROM world_state_agent_tasks
      WHERE id = $1 AND status = 'queued'
      FOR UPDATE SKIP LOCKED`,
    [taskId],
  );
  if (!taskResult.rows.length) return null;
  const task = taskResult.rows[0];

  await db(`UPDATE world_state_agent_tasks SET status='running', started_at=NOW(), updated_at=NOW() WHERE id=$1`, [task.id]);
  try {
    const p = task.payload || {};
    const result = reconcileWorldState({
      previous: p.previous || null,
      observed: {
        lat: task.observed_lat ?? p.observed_lat,
        lng: task.observed_lng ?? p.observed_lng,
        accuracy_m: p.accuracy_m,
        heading: p.heading,
      },
      route: p.route || null,
      elapsedSeconds: Number(p.elapsed_seconds || 0),
      observedAt: task.observed_at || p.observed_at || new Date(now).toISOString(),
      now,
    });

    await db(`UPDATE world_state_agent_tasks SET status='completed', result=$2::jsonb, completed_at=NOW(), updated_at=NOW() WHERE id=$1`, [task.id, JSON.stringify(result)]);
    return result;
  } catch (err) {
    await db(`UPDATE world_state_agent_tasks SET status='failed', result=$2::jsonb, completed_at=NOW(), updated_at=NOW() WHERE id=$1`, [task.id, JSON.stringify({ error: 'reconciliation_failed', message: err.message })]);
    throw err;
  }
}

async function processBatch({ db, limit = 20, now = Date.now() }) {
  const rows = await db(
    `SELECT id FROM world_state_agent_tasks
      WHERE status='queued'
      ORDER BY CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, created_at
      LIMIT $1`,
    [Math.min(100, Math.max(1, Number(limit) || 20))],
  );
  const results = [];
  for (const row of rows.rows) {
    try { results.push(await processOne({ db, taskId: row.id, now })); } catch { /* durable failure already recorded */ }
  }
  return results.filter(Boolean);
}

module.exports = { processOne, processBatch };
