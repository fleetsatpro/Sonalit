require('dotenv').config();
const { runNewsMesh } = require('../utils/intelligenceNewsMesh');
const { runCollectionFabric } = require('../utils/collectionFabric');
const { runRegionalIncidentSweep } = require('../utils/regionalIncidentFabric');
const { runIntelligenceAgents, runScheduledPublicationBoundary, anyCountryPublicationBoundary, msUntilAnyCountryPublicationBoundary } = require('../utils/intelligenceAgents');
const { generateMissingPublicationPdfs } = require('../services/intelligencePublicationPdf');
const { buildWorldContext } = require('../services/spatial/worldContextService');
const { providerCapabilities } = require('../utils/aiClient');
const { withOrg } = require('../utils/orgScopedDb');
const { publish } = require('../realtime/centrifugo');
const { query, globalQuery, pool } = require('../config/database');
const { withAdvisoryLock, startAdvisoryLeader } = require('../utils/workerExecutionGuard');
const logger = require('../utils/logger');

const intervalMs = Math.max(5, Number(process.env.INTEL_COLLECTION_INTERVAL_MINUTES || 5)) * 60 * 1000;
const spatialIntervalMs = Math.max(15, Number(process.env.SPATIAL_EYE_INTERVAL_SECONDS || 60)) * 1000;
const spatialMaxConvoys = Math.max(1, Math.min(100, Number(process.env.SPATIAL_EYE_MAX_CONVOYS_PER_CYCLE || 25)));
const spatialConcurrency = Math.max(1, Math.min(6, Number(process.env.SPATIAL_EYE_CONCURRENCY || 3)));
let stopping = false;
let timer = null;
let spatialTimer = null;
let spatialRunning = false;
let spatialCursor = { orgId: null, convoyId: null };
let activeCyclePromise = null;
let activeSpatialPromise = null;
let publicationTimer = null;
let activePublicationPromise = null;
let advisoryLeader = null;

async function evaluateSpatialEyeUnsafe(reason = 'scheduled') {
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
      ? await globalQuery(
          baseSql +
          "AND (org_id > $1 OR (org_id = $1 AND id > $2)) ORDER BY org_id, id LIMIT $3",
          [cursor.orgId, cursor.convoyId, spatialMaxConvoys]
        )
      : await globalQuery(baseSql + "ORDER BY org_id, id LIMIT $1", [spatialMaxConvoys]);

    let rows = page.rows || [];
    if (!rows.length && cursor) {
      spatialCursor = { orgId: null, convoyId: null };
      const wrapped = await globalQuery(baseSql + "ORDER BY org_id, id LIMIT $1", [spatialMaxConvoys]);
      rows = wrapped.rows || [];
    }
    if (!rows.length) return { evaluated: 0, eventCount: 0, skipped: false };

    const selected = rows.slice(0, spatialMaxConvoys);
    const last = selected[selected.length - 1];
    spatialCursor = last
      ? { orgId: String(last.org_id), convoyId: String(last.id) }
      : { orgId: null, convoyId: null };

    for (let offset = 0; offset < selected.length; offset += spatialConcurrency) {
      const batch = selected.slice(offset, offset + spatialConcurrency);
      await Promise.all(batch.map(async (row) => {
        if (!row?.org_id || !row?.id) return;
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
      }));
    }
  } catch (error) {
    logger.warn(`Spatial Eye global evaluation failed: ${error.message}`);
  } finally {
    spatialRunning = false;
    logger.info(`Spatial Eye cycle complete (${reason}) in ${Date.now() - started}ms: evaluated=${evaluated}, events=${eventCount}, maxConvoys=${spatialMaxConvoys}, concurrency=${spatialConcurrency}`);
  }
  return { evaluated, eventCount, skipped: false };
}

async function evaluateSpatialEye(reason = 'scheduled') {
  if (stopping) return { evaluated: 0, eventCount: 0, skipped: true };
  const guarded = await withAdvisoryLock('sonalit:intelligence:spatial-eye', function () {
    return evaluateSpatialEyeUnsafe(reason);
  });
  if (!guarded.locked) {
    logger.info('Spatial Eye cycle skipped (' + reason + '): another intelligence worker owns the cluster lock');
    return { evaluated: 0, eventCount: 0, skipped: true, reason: 'cluster_run_in_progress' };
  }
  return guarded.value;
}
async function cycleUnsafe(reason) {
  if (stopping) return;
  const started = Date.now();
  try {
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
    try { agents = await runIntelligenceAgents({includePublications:false}); } catch (error) { logger.warn(`Intelligence agents cycle failed: ${error.message}`); }

    // PDF rendering is publication-work, not collection-work. It runs only from the
    // country-local midnight publication boundary below.
    const pdfs = [];

    const meshSeen = mesh.reduce((sum, x) => sum + Number(x.seen || 0), 0);
    const meshInserted = mesh.reduce((sum, x) => sum + Number(x.inserted || 0), 0);
    const synth = agents.reduce((sum, x) => sum + Number(x.synthesis?.synthesized || 0), 0);
    const translated = agents.reduce((sum, x) => sum + Number(x.translation?.translated || 0), 0);
    const pdfReady = pdfs.filter(x => x.status === 'ready').length;
    const publicationResults = agents.flatMap(x => Array.isArray(x.publications?.results) ? x.publications.results : []);
    const publicationPublished = publicationResults.filter(x => x.publication_status === 'published').length;
    const publicationDrafts = publicationResults.filter(x => x.publication_status === 'draft').length;
    const publicationExisting = publicationResults.filter(x => x.publication_status && x.status === 'exists').length;
    const publicationFailures = publicationResults.filter(x => x.status === 'failed' || x.error).length;
    const pdfFailed = pdfs.filter(x => x.status === 'failed' || x.error).length;
    logger.info(`Intelligence worker cycle complete (${reason}) in ${Date.now() - started}ms: orgs=${result?.organizations ?? 0}, mesh_seen=${meshSeen}, mesh_inserted=${meshInserted}, discovered=${discovered}, ingested=${ingested}, translated=${translated}, synthesized=${synth}, publications_processed=${publicationResults.length}, publications_published=${publicationPublished}, publications_drafts=${publicationDrafts}, publications_existing=${publicationExisting}, publication_failures=${publicationFailures}, publication_pdfs_ready=${pdfReady}, publication_pdf_failures=${pdfFailed}, regional_seen=${regionalSeen}, regional_inserted=${regionalInserted}, incident_alerts=${alertCount}`);
  } catch (error) {
    logger.error(`Intelligence worker cycle failed (${reason}): ${error.message}`);
  }
}

async function cycle(reason) {
  if (stopping) return;
  const guarded = await withAdvisoryLock('sonalit:intelligence:cycle', function () {
    return cycleUnsafe(reason);
  });
  if (!guarded.locked) {
    logger.info('Intelligence worker cycle skipped (' + reason + '): another worker owns the cluster lock');
    return;
  }
  return guarded.value;
}
function msUntilNextPublicationBoundary(now=new Date()){
  return msUntilAnyCountryPublicationBoundary(now);
}
async function runPublicationBoundary(reason='scheduled-local-midnight'){
  if(stopping)return;
  const guarded=await withAdvisoryLock('sonalit:intelligence:publication-boundary',async()=>{
    const now=new Date();
    if(!anyCountryPublicationBoundary(now))return{skipped:true,reason:'boundary-missed'};
    activePublicationPromise=runScheduledPublicationBoundary(now);
    try{
      const result=await activePublicationPromise;
      let pdfs=[];
      for(const org of result?.results||[]){
        if(!org?.org_id)continue;
        try{
          const generated=await generateMissingPublicationPdfs(org.org_id,Number(process.env.INTEL_PUBLICATION_PDF_BATCH||8));
          pdfs.push(...generated.map(x=>({org_id:org.org_id,...x})));
        }catch(error){logger.warn('Publication boundary PDF cycle failed org='+org.org_id+': '+error.message);}
      }
      return{...result,pdfs,reason};
    }finally{activePublicationPromise=null;}
  });
  if(!guarded.locked){logger.info('Publication boundary skipped: another intelligence worker owns the cluster lock');return null;}
  return guarded.value;
}
function schedulePublicationBoundary(){
  if(stopping)return;
  if(publicationTimer)clearTimeout(publicationTimer);
  const delay=msUntilNextPublicationBoundary(new Date());
  publicationTimer=setTimeout(()=>{
    void runPublicationBoundary('scheduled-local-midnight').catch(error=>logger.warn('Publication boundary failed: '+error.message)).finally(()=>schedulePublicationBoundary());
  },delay);
  logger.info('Next country-local intelligence publication boundary scheduled in '+Math.round(delay/1000)+'s');
}
function scheduleSpatial() {
  if (stopping) return;
  spatialTimer = setTimeout(() => {
    activeSpatialPromise = evaluateSpatialEye('scheduled')
      .catch(error => logger.warn(`Spatial Eye scheduled run failed: ${error.message}`))
      .finally(() => { activeSpatialPromise = null; });
    activeSpatialPromise.finally(() => scheduleSpatial());
  }, spatialIntervalMs);
}

function schedule() {
  if (stopping) return;
  timer = setTimeout(() => {
    activeCyclePromise = cycle('scheduled')
      .catch(error => logger.warn(`Intelligence scheduled cycle failed: ${error.message}`))
      .finally(() => { activeCyclePromise = null; });
    activeCyclePromise.finally(() => schedule());
  }, intervalMs);
}

async function drainActiveWork(reason) {
  if (timer) clearTimeout(timer);
  if (spatialTimer) clearTimeout(spatialTimer);
  if (publicationTimer) clearTimeout(publicationTimer);
  timer = null;
  spatialTimer = null;
  publicationTimer = null;
  const running = [activeCyclePromise, activeSpatialPromise, activePublicationPromise].filter(Boolean);
  let drained = true;
  if (running.length) {
    drained = await Promise.race([
      Promise.allSettled(running).then(() => true),
      new Promise(resolve => setTimeout(() => resolve(false), 20000))
    ]);
  }
  logger.info(`Intelligence worker quiesced (${reason}); drained=${drained}`);
  return drained;
}

async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  logger.info(`Intelligence worker shutting down (${signal})`);
  const drained = await drainActiveWork(signal);
  await advisoryLeader?.stop?.().catch(() => {});
  if (!drained) {
    logger.error('Intelligence worker shutdown drain timed out; exiting without closing the pool');
    process.exit(78);
  }
  await pool.end().catch(() => {});
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

(async () => {
  logger.info(`Intelligence worker online; collection cadence=${intervalMs / 60000}m; spatial cadence=${spatialIntervalMs / 1000}s; news mesh + synthesis agents enabled`);
  logger.info(`Intelligence AI provider readiness: ${JSON.stringify(providerCapabilities())}`);
  try {
    const context = await globalQuery(`SELECT current_user, session_user, current_setting('app.current_org_id', true) AS rls_org, (SELECT count(*)::int FROM users WHERE deleted_at IS NULL) AS visible_users`);
    logger.info(`Intelligence worker DB context: current_user=${context.rows[0]?.current_user} session_user=${context.rows[0]?.session_user} rls_org=${context.rows[0]?.rls_org || 'unset'} visible_users=${context.rows[0]?.visible_users ?? 0}`);
  } catch (error) {
    logger.warn(`Intelligence worker DB context probe failed: ${error.message}`);
  }

  advisoryLeader = await startAdvisoryLeader('sonalit:intelligence:leader', {
    retryMs: 15000,
    logger,
    onAcquire: async () => {
      stopping = false;
      logger.info('Intelligence worker leader active');
      activeCyclePromise = (async () => {
        await evaluateSpatialEye('startup');
        await cycle('startup');
      })();
      try {
        await activeCyclePromise;
      } finally {
        activeCyclePromise = null;
      }

      // Backfill the most recently completed daily reporting period once after a
      // worker deployment/restart. This repairs publications missed during an
      // earlier outage without changing the strict local-midnight schedule for
      // subsequent editions. Existing published editions short-circuit as unchanged.
      try {
        const catchup = await runIntelligenceAgents({
          includePublications: true,
          forceDailyPublications: true,
          now: new Date(),
        });
        const results = catchup.flatMap(x => Array.isArray(x.publications?.results) ? x.publications.results : []);
        const published = results.filter(x => x.publication_status === 'published').length;
        const drafts = results.filter(x => x.publication_status === 'draft').length;
        const failures = results.filter(x => x.status === 'failed' || x.error).length;
        const pdfs = [];
        for (const org of catchup) {
          if (!org?.org_id) continue;
          try {
            const generated = await generateMissingPublicationPdfs(org.org_id, Number(process.env.INTEL_PUBLICATION_PDF_BATCH || 8));
            pdfs.push(...generated.map(x => ({ org_id: org.org_id, ...x })));
          } catch (error) {
            logger.warn(`Publication startup catch-up PDF cycle failed org=${org.org_id}: ${error.message}`);
          }
        }
        const pdfReady = pdfs.filter(x => x.status === 'ready').length;
        const pdfFailed = pdfs.filter(x => x.status === 'failed' || x.error).length;
        logger.info(`Intelligence publication startup catch-up: processed=${results.length}, published=${published}, drafts=${drafts}, failures=${failures}, pdf_ready=${pdfReady}, pdf_failures=${pdfFailed}`);
      } catch (error) {
        logger.warn(`Intelligence publication startup catch-up failed: ${error.message}`);
      }

      scheduleSpatial();
      schedulePublicationBoundary();
      schedule();
    },
    onLose: async () => {
      stopping = true;
      const drained = await drainActiveWork('leadership loss');
      if (!drained) {
        logger.error('Intelligence worker could not drain after leader loss; exiting fail-closed');
        process.exit(78);
      }
      stopping = false;
    }
  });
  advisoryLeader.promise.catch(error => {
    logger.error(`Intelligence advisory leader loop stopped unexpectedly: ${error.message}`);
    if (!stopping) void shutdown('LEADER_LOOP_FAILURE');
  });
})();
