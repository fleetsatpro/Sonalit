require('dotenv').config();
const { runNewsMesh } = require('../utils/intelligenceNewsMesh');
const { runCollectionFabric } = require('../utils/collectionFabric');
const { runRegionalIncidentSweep } = require('../utils/regionalIncidentFabric');
const { runIntelligenceAgents } = require('../utils/intelligenceAgents');
const { generateMissingPublicationPdfs } = require('../services/intelligencePublicationPdf');
const { buildWorldContext } = require('../services/spatial/worldContextService');
const { withOrg } = require('../utils/orgScopedDb');
const { publish } = require('../realtime/centrifugo');
const { query } = require('../config/database');
const logger = require('../utils/logger');

const intervalMs = Math.max(5, Number(process.env.INTEL_COLLECTION_INTERVAL_MINUTES || 5)) * 60 * 1000;
const spatialIntervalMs = Math.max(15, Number(process.env.SPATIAL_EYE_INTERVAL_SECONDS || 60)) * 1000;
const spatialMaxConvoys = Math.max(1, Math.min(100, Number(process.env.SPATIAL_EYE_MAX_CONVOYS_PER_CYCLE || 25)));
let stopping = false;
let timer = null;
let spatialTimer = null;
let spatialRunning = false;
let spatialCursor = { orgId: null, convoyId: null };

async function evaluateSpatialEye(reason = 'scheduled') {
  if (spatialRunning || stopping) return { evaluated: 0, eventCount: 0, skipped: true };
  spatialRunning = true;
  let evaluated = 0;
  let eventCount = 0;
  const started = Date.now();
  try {
    const cursor = spatialCursor.orgId && spatialCursor.convoyId
      ? { orgId: spatialCursor.orgId, convoyId: spatialCursor.convoyId }
      : null;
    const baseSql = "SELECT id, org_id FROM convoys " +
      "WHERE org_id IS NOT NULL AND status = 'active' AND deleted_at IS NULL ";
    const page = cursor
      ? await query(
          baseSql +
          "AND (org_id > $1 OR (org_id = $1 AND id > $2)) ORDER BY org_id, id LIMIT $3",
          [cursor.orgId, cursor.convoyId, spatialMaxConvoys]
        )
      : await query(baseSql + "ORDER BY org_id, id LIMIT $1", [spatialMaxConvoys]);

    let rows = page.rows || [];
    if (!rows.length && cursor) {
      spatialCursor = { orgId: null, convoyId: null };
      const wrapped = await query(baseSql + "ORDER BY org_id, id LIMIT $1", [spatialMaxConvoys]);
      rows = wrapped.rows || [];
    }
    if (!rows.length) return { evaluated: 0, eventCount: 0, skipped: false };

    const selected = rows.slice(0, spatialMaxConvoys);
    const last = selected[selected.length - 1];
    spatialCursor = last
      ? { orgId: String(last.org_id), convoyId: String(last.id) }
      : { orgId: null, convoyId: null };

    for (const row of selected) {
      if (!row?.org_id || !row?.id) continue;
      try {
        const context = await buildWorldContext({
          orgId: row.org_id,
          userId: null,
          db: (sql, params) => withOrg(row.org_id, (scopedClient) => scopedClient.query(sql, params)),
          subject: { kind: 'convoy', id: String(row.id) },
          layers: ['aircraft','weather','maritime','traffic','hazards','security','infrastructure','incidents','alerts'],
          maxEntitiesPerLayer: 100,
          requestId: 'spatial-eye:' + reason + ':' + String(row.id),
          persistEvents: true,
          publish
        });
        evaluated += 1;
        eventCount += Array.isArray(context.events) ? context.events.length : 0;
      } catch (error) {
        logger.warn(`Spatial Eye convoy evaluation failed org=${row.org_id} convoy=${row.id}: ${error.message}`);
      }
    }
  } catch (error) {
    logger.warn(`Spatial Eye global evaluation failed: ${error.message}`);
  } finally {
    spatialRunning = false;
    logger.info(`Spatial Eye cycle complete (${reason}) in ${Date.now() - started}ms: evaluated=${evaluated}, events=${eventCount}, maxConvoys=${spatialMaxConvoys}`);
  }
  return { evaluated, eventCount, skipped: false };
}

async function cycle(reason) {
  if (stopping) return;
  const started = Date.now();
  try {
    let spatialEvaluated = 0;
    let spatialEvents = 0;
    let mesh = [];
    try { mesh = await runNewsMesh(); } catch (error) { logger.warn(`News Mesh cycle failed: ${error.message}`); }

    const result = await runCollectionFabric();
    const discovered = Number(result?.discovered || 0);
    const ingested = Number(result?.ingested || 0);
    let alertCount = 0;
    let regionalSeen = 0;
    let regionalInserted = 0;
    for (const org of result?.results || []) {
      if (!org?.org_id) continue;
      try {
        const alerts = await runRegionalIncidentSweep(org.org_id);
        alertCount += Number(alerts?.totalAlerts || 0);
        regionalSeen += Number(alerts?.totalSeen || 0);
        regionalInserted += Number(alerts?.totalInserted || 0);
      } catch (error) {
        logger.warn(`Regional Incident Fabric failed for org=${org.org_id}: ${error.message}`);
      }
    }

    let agents = [];
    try { agents = await runIntelligenceAgents(); } catch (error) { logger.warn(`Intelligence agents cycle failed: ${error.message}`); }

    let pdfs = [];
    for (const org of agents) {
      if (!org?.org_id) continue;
      try {
        const generated = await generateMissingPublicationPdfs(org.org_id, Number(process.env.INTEL_PUBLICATION_PDF_BATCH || 3));
        pdfs.push(...generated.map(x => ({ org_id: org.org_id, ...x })));
      } catch (error) {
        logger.warn(`Publication PDF cycle failed org=${org.org_id}: ${error.message}`);
      }
    }

    const meshSeen = mesh.reduce((sum, x) => sum + Number(x.seen || 0), 0);
    const meshInserted = mesh.reduce((sum, x) => sum + Number(x.inserted || 0), 0);
    const synth = agents.reduce((sum, x) => sum + Number(x.synthesis?.synthesized || 0), 0);
    const translated = agents.reduce((sum, x) => sum + Number(x.translation?.translated || 0), 0);
    const pdfReady = pdfs.filter(x => x.status === 'ready').length;
    logger.info(`Intelligence worker cycle complete (${reason}) in ${Date.now() - started}ms: spatial_convoys=${spatialEvaluated}, spatial_events=${spatialEvents}, orgs=${result?.organizations ?? 0}, mesh_seen=${meshSeen}, mesh_inserted=${meshInserted}, discovered=${discovered}, ingested=${ingested}, translated=${translated}, synthesized=${synth}, publication_pdfs_ready=${pdfReady}, regional_seen=${regionalSeen}, regional_inserted=${regionalInserted}, incident_alerts=${alertCount}`);
  } catch (error) {
    logger.error(`Intelligence worker cycle failed (${reason}): ${error.message}`);
  }
}

function scheduleSpatial() {
  if (stopping) return;
  spatialTimer = setTimeout(async () => {
    await evaluateSpatialEye('scheduled');
    scheduleSpatial();
  }, spatialIntervalMs);
}

function schedule() {
  if (stopping) return;
  timer = setTimeout(async () => {
    await cycle('scheduled');
    schedule();
  }, intervalMs);
}

async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  if (timer) clearTimeout(timer);
  if (spatialTimer) clearTimeout(spatialTimer);
  logger.info(`Intelligence worker shutting down (${signal})`);
  try {
    const { pool } = require('../config/database');
    await pool.end();
  } catch (_) {}
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

(async () => {
  logger.info(`Intelligence worker online; collection cadence=${intervalMs / 60000}m; spatial cadence=${spatialIntervalMs / 1000}s; news mesh + synthesis agents enabled`);
  try {
    const context = await query(`SELECT current_user, session_user, current_setting('app.current_org_id', true) AS rls_org, (SELECT count(*)::int FROM users WHERE deleted_at IS NULL) AS visible_users`);
    logger.info(`Intelligence worker DB context: current_user=${context.rows[0]?.current_user} session_user=${context.rows[0]?.session_user} rls_org=${context.rows[0]?.rls_org || 'unset'} visible_users=${context.rows[0]?.visible_users ?? 0}`);
  } catch (error) {
    logger.warn(`Intelligence worker DB context probe failed: ${error.message}`);
  }
  await evaluateSpatialEye('startup');
  await cycle('startup');
  scheduleSpatial();
  schedule();
})();
