/**
 * convoyReportWorker — processes convoyReport and convoyArchive queues.
 *
 * Job names on convoyReport queue:
 *   checkProgress  — recounts photos and updates daily report status
 *   generateReport — generates PDF and uploads to R2
 *
 * Job names on convoyArchive queue:
 *   generateArchive — builds full-convoy archive PDF on convoy completion
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const path = require('path');
const fs = require('fs');
const { Worker } = require('bullmq');
const { pool, query } = require('../config/database');
const { publish } = require('../realtime/centrifugo');
const { generateDailyReport, generateArchiveReport } = require('../utils/convoyPdfGenerator');
const logger = require('../utils/logger');

function getRedisConnection() {
  const url = new URL(process.env.REDIS_URL || 'redis://127.0.0.1:6379');
  return {
    host: url.hostname,
    port: parseInt(url.port) || 6379,
    password: url.password || process.env.REDIS_PASSWORD || undefined,
  };
}

// ─── R2 Upload Helper ─────────────────────────────────────────────────────────

async function uploadToR2(key, buffer, contentType) {
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY, R2_SECRET_KEY, R2_BUCKET, R2_PUBLIC_URL } = process.env;
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY || !R2_SECRET_KEY || !R2_BUCKET) {
    throw new Error('R2 not configured');
  }
  // R2_PUBLIC_URL is required too: R2's native r2.cloudflarestorage.com endpoint
  // has no virtual-hosted-style public-read addressing (unlike S3) — every GET
  // there needs SigV4 auth. Without a real public base URL (custom domain or
  // r2.dev), there is no reachable URL to construct. Throwing here (rather than
  // silently building one that 404s/403s) routes generateReport's caller into
  // the existing local-filesystem fallback below instead of "succeeding" with
  // an unusable pdf_url.
  if (!R2_PUBLIC_URL) {
    throw new Error('R2_PUBLIC_URL not configured');
  }
  const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
  const s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: R2_ACCESS_KEY, secretAccessKey: R2_SECRET_KEY },
  });
  // no-store: convoyreports.sonalit.com fronts this bucket through Cloudflare,
  // which caches static file extensions like .pdf at the edge by default. The
  // report key is now content-hashed (see callers) so this is defense in
  // depth, not the primary fix — but without it a CDN or browser could still
  // cache an old response for a URL that happens to get reused.
  await s3.send(new PutObjectCommand({
    Bucket: R2_BUCKET, Key: key, Body: buffer, ContentType: contentType, CacheControl: 'no-store',
  }));
  return `${R2_PUBLIC_URL}/${key}`;
}

// ─── DB Helpers ───────────────────────────────────────────────────────────────

async function fetchReportData(convoy_id, report_date) {
  const [convoyRes, trucksRes, cfosRes, photosRes, reportRes, cfoPhotosRes, waypointsRes, namedWaypointsRes] = await Promise.all([
    query(
      `SELECT c.*, cl.name AS client_name, cl.company AS client_company
       FROM convoys c LEFT JOIN cargo_clients cl ON cl.id = c.client_id
       WHERE c.id = $1`,
      [convoy_id]
    ),
    query(
      `SELECT ct.*, COALESCE(ct.registration, v.registration) AS plate_number
       FROM convoy_trucks ct
       LEFT JOIN vehicles v ON v.id = ct.vehicle_id
       WHERE ct.convoy_id = $1
       ORDER BY ct.position`,
      [convoy_id]
    ),
    query(
      `SELECT cc.*, u.name AS cfo_name, u.email AS cfo_email
       FROM convoy_cfos cc JOIN users u ON u.id = cc.cfo_user_id
       WHERE cc.convoy_id = $1`,
      [convoy_id]
    ),
    query(
      // DISTINCT ON keeps only the most recent upload per slot — retaking a
      // photo from the CFO app inserts a new row instead of replacing the
      // old one, so the PDF/report must dedupe or it double-counts photos.
      `SELECT DISTINCT ON (convoy_truck_id, session, photo_type, COALESCE(seal_position, '')) *
       FROM convoy_truck_photos WHERE convoy_id = $1 AND report_date = $2
       ORDER BY convoy_truck_id, session, photo_type, COALESCE(seal_position, ''), uploaded_at DESC`,
      [convoy_id, report_date]
    ),
    query(
      `SELECT * FROM convoy_daily_reports WHERE convoy_id = $1 AND report_date = $2`,
      [convoy_id, report_date]
    ),
    query(
      `SELECT pu.id, pu.phase AS session, pu.photo_type, pu.r2_url AS photo_url,
              pu.plate_number, pu.lat, pu.lng, pu.timestamp AS taken_at, u.name AS cfo_name
       FROM photo_uploads pu
       LEFT JOIN users u ON u.id::text = pu.cfo_id
       WHERE pu.convoy_id = $1::text AND pu.timestamp::date = $2::date
       ORDER BY pu.timestamp`,
      [convoy_id, report_date]
    ),
    query(
      `SELECT lat, lng, speed_kmh, heading, recorded_at
       FROM convoy_waypoints
       WHERE convoy_id = $1 AND recorded_at::date = $2::date
       ORDER BY recorded_at
       LIMIT 500`,
      [convoy_id, report_date]
    ),
    query(
      `SELECT seq, name, lat, lng FROM convoy_route_waypoints WHERE convoy_id = $1 ORDER BY seq`,
      [convoy_id]
    ),
  ]);
  return {
    convoy: convoyRes.rows[0],
    trucks: trucksRes.rows,
    cfos: cfosRes.rows,
    photos: photosRes.rows,
    report: reportRes.rows[0],
    cfoPhotos: cfoPhotosRes.rows,
    waypoints: waypointsRes.rows,
    namedWaypoints: namedWaypointsRes.rows,
  };
}

async function recountPhotos(convoy_id, report_date) {
  const truckCountRes = await query(
    `SELECT COUNT(DISTINCT ct.id) AS truck_count, c.seal_count_per_truck
     FROM convoys c JOIN convoy_trucks ct ON ct.convoy_id = c.id
     WHERE c.id = $1
       AND EXISTS (SELECT 1 FROM convoy_cfo_truck_assignments ccta WHERE ccta.convoy_truck_id = ct.id)
     GROUP BY c.seal_count_per_truck`,
    [convoy_id]
  );
  if (!truckCountRes.rows.length) return;

  const { truck_count, seal_count_per_truck } = truckCountRes.rows[0];
  const required = parseInt(truck_count) * (2 + parseInt(seal_count_per_truck)) * 2;

  // seal_position is the CFO-entered RFID code, not a fixed slot index, so a
  // truck can accumulate more distinct values than seal_count_per_truck
  // allows (typo, re-scan, genuine reseal) — cap each truck+session's seal
  // contribution so received_photo_count can never exceed required.
  const recvRes = await query(
    `WITH slot_counts AS (
       SELECT convoy_truck_id, session, photo_type,
              COUNT(DISTINCT COALESCE(seal_position, '')) AS n
       FROM convoy_truck_photos
       WHERE convoy_id = $1 AND report_date = $2
       GROUP BY convoy_truck_id, session, photo_type
     )
     SELECT COALESCE(SUM(
       CASE WHEN photo_type = 'seal' THEN LEAST(n, $3::int) ELSE LEAST(n, 1) END
     ), 0) AS received
     FROM slot_counts`,
    [convoy_id, report_date, seal_count_per_truck]
  );
  // Final backstop: a truck can have photos from before it was unassigned/
  // removed, which the per-slot cap above doesn't know to exclude since it
  // sums across whatever trucks have photo rows, not just currently-required
  // ones. received must never be able to exceed required.
  const received = Math.min(parseInt(recvRes.rows[0].received), required);
  const status = received >= required ? 'complete' : received > 0 ? 'partial' : 'pending';

  await query(
    `INSERT INTO convoy_daily_reports (convoy_id, report_date, required_photo_count, received_photo_count, status)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (convoy_id, report_date) DO UPDATE
       SET required_photo_count = $3,
           received_photo_count = $4,
           status = CASE WHEN convoy_daily_reports.status IN ('generated') THEN convoy_daily_reports.status ELSE $5 END,
           updated_at = NOW()`,
    [convoy_id, report_date, required, received, status]
  );
  return { required, received, status };
}

// ─── Job Handlers ─────────────────────────────────────────────────────────────

async function handleCheckProgress({ convoy_id, report_date }) {
  const counts = await recountPhotos(convoy_id, report_date);
  if (counts?.status === 'complete') {
    logger.info(`[convoyReport] ${convoy_id} ${report_date} complete — queuing generateReport`);
    // Re-enqueue self as generateReport so it flows to PDF generation
    const { getQueues } = require('../config/queue');
    const { convoyReportQueue } = getQueues();
    if (convoyReportQueue) {
      await convoyReportQueue.add('generateReport', { convoy_id, report_date });
    }
  }
}

async function handleGenerateReport({ convoy_id, report_date, force }) {
  const { convoy, trucks, cfos, photos, report, cfoPhotos, waypoints, namedWaypoints } = await fetchReportData(convoy_id, report_date);
  if (!convoy) throw new Error(`Convoy ${convoy_id} not found`);
  if (!report) {
    logger.warn(`[convoyReport] No daily report row for ${convoy_id} ${report_date} — running recount`);
    await recountPhotos(convoy_id, report_date);
    return;
  }
  if (report.status === 'generated' && !force) {
    logger.info(`[convoyReport] ${convoy_id} ${report_date} already generated — skipping`);
    return;
  }

  const pdfBuffer = await generateDailyReport(convoy, trucks, cfos, photos, report, report_date, cfoPhotos, waypoints, namedWaypoints);
  // Every regenerate reused the exact same R2 key/URL for a given
  // convoy+date, so once Cloudflare's edge (which fronts the R2 custom
  // domain) cached that URL, "Regenerate" kept overwriting the R2 origin
  // object while every download kept serving the original cached response
  // forever — confirmed by a report showing the identical Report ID and
  // generated_at timestamp across regenerations hours apart. Content-hashing
  // the key means a genuinely new PDF always gets a URL that could never
  // have been cached before, independent of any CDN behavior.
  const contentHash = require('crypto').createHash('sha256').update(pdfBuffer).digest('hex');
  const key = `reports/daily/${convoy_id}/${report_date}-${contentHash.slice(0, 12)}.pdf`;

  let pdfUrl = null;
  let generationError = null;
  try {
    pdfUrl = await uploadToR2(key, pdfBuffer, 'application/pdf');
    logger.info(`[convoyReport] PDF uploaded to R2: ${pdfUrl}`);
  } catch (uploadErr) {
    logger.warn(`[convoyReport] R2 unavailable (${uploadErr.message}) — storing PDF locally`);
    try {
      const reportsDir = path.resolve(__dirname, '../../data/reports', convoy_id);
      fs.mkdirSync(reportsDir, { recursive: true });
      fs.writeFileSync(path.join(reportsDir, `${report_date}.pdf`), pdfBuffer);
      logger.info(`[convoyReport] PDF saved locally for ${convoy_id}/${report_date}`);
    } catch (fsErr) {
      generationError = `R2: ${uploadErr.message}; local: ${fsErr.message}`;
      logger.error(`[convoyReport] local PDF save also failed: ${fsErr.message}`);
    }
  }

  const orgRow = await query(`SELECT org_id FROM convoys WHERE id = $1`, [convoy_id]);
  const orgId = orgRow.rows[0]?.org_id || convoy_id;

  try {
    await query(
      `UPDATE convoy_daily_reports
       SET status = 'generated', pdf_url = $1, content_hash = $2,
           generation_error = $3, pdf_data = $4, generated_at = NOW(), updated_at = NOW()
       WHERE convoy_id = $5 AND report_date = $6`,
      [pdfUrl, contentHash, generationError, pdfBuffer, convoy_id, report_date]
    );
  } catch (updateErr) {
    // 42703 = undefined_column — the pdf_data migration hasn't applied on
    // this database yet. Don't let that abort the whole generation (the
    // report would stay stuck on 'partial' forever with no PDF at all);
    // fall back to the pre-migration column set so status still correctly
    // flips to 'generated' with whatever pdf_url/R2 or local storage did
    // succeed, at the cost of the DB-backed durability fallback until the
    // migration actually runs.
    if (updateErr.code === '42703') {
      logger.warn('[convoyReport] pdf_data column missing (migration not yet applied) — saving without it');
      await query(
        `UPDATE convoy_daily_reports
         SET status = 'generated', pdf_url = $1, content_hash = $2,
             generation_error = $3, generated_at = NOW(), updated_at = NOW()
         WHERE convoy_id = $4 AND report_date = $5`,
        [pdfUrl, contentHash, generationError, convoy_id, report_date]
      );
    } else {
      throw updateErr;
    }
  }

  publish(`convoy.report.ready.${orgId}`, { convoy_id, report_date, pdf_url: pdfUrl });
  logger.info(`[convoyReport] report marked generated for ${convoy_id}/${report_date}`);
}

async function handleGenerateArchive({ convoy_id }) {
  const convoy = (await query(
    `SELECT c.*, cl.name AS client_name, cl.company AS client_company
     FROM convoys c LEFT JOIN cargo_clients cl ON cl.id = c.client_id
     WHERE c.id = $1`,
    [convoy_id]
  )).rows[0];
  if (!convoy) throw new Error(`Convoy ${convoy_id} not found`);

  const [trucks, cfos, reports, allPhotos] = await Promise.all([
    query(
      `SELECT ct.*, COALESCE(ct.registration, v.registration) AS plate_number
       FROM convoy_trucks ct
       LEFT JOIN vehicles v ON v.id = ct.vehicle_id
       WHERE ct.convoy_id = $1
       ORDER BY ct.position`,
      [convoy_id]
    ),
    query(
      `SELECT cc.*, u.name AS cfo_name, u.email AS cfo_email
       FROM convoy_cfos cc JOIN users u ON u.id = cc.cfo_user_id
       WHERE cc.convoy_id = $1`,
      [convoy_id]
    ),
    query(
      `SELECT * FROM convoy_daily_reports WHERE convoy_id = $1 ORDER BY report_date`,
      [convoy_id]
    ),
    query('SELECT * FROM convoy_truck_photos WHERE convoy_id = $1', [convoy_id]),
  ]);

  const pdfBuffer = await generateArchiveReport(convoy, trucks.rows, cfos.rows, reports.rows, allPhotos.rows);
  // Same content-hashed key fix as handleGenerateReport — a static key
  // reused on every regeneration lets a fronting CDN keep serving a stale
  // cached copy forever regardless of how many times the R2 origin object
  // is overwritten.
  const archiveHash = require('crypto').createHash('sha256').update(pdfBuffer).digest('hex');
  const key = `reports/archive/${convoy_id}/archive-${archiveHash.slice(0, 12)}.pdf`;

  let pdfUrl = null;
  try {
    pdfUrl = await uploadToR2(key, pdfBuffer, 'application/pdf');
    logger.info(`[convoyArchive] Archive PDF uploaded to R2: ${pdfUrl}`);
  } catch (uploadErr) {
    logger.warn(`[convoyArchive] R2 unavailable (${uploadErr.message}) — saving locally`);
    try {
      const archiveDir = path.resolve(__dirname, '../../data/reports', convoy_id);
      fs.mkdirSync(archiveDir, { recursive: true });
      fs.writeFileSync(path.join(archiveDir, 'archive.pdf'), pdfBuffer);
    } catch (fsErr) {
      logger.error(`[convoyArchive] Local save also failed: ${fsErr.message}`);
    }
  }

  await query(
    `UPDATE convoys SET archive_pdf_url = $1, updated_at = NOW() WHERE id = $2`,
    [pdfUrl, convoy_id]
  );
  logger.info(`[convoyArchive] Archive report processed for ${convoy_id}`);
}

async function handleScheduledRecount() {
  const active = await query(
    `SELECT DISTINCT cdr.convoy_id, cdr.report_date
     FROM convoy_daily_reports cdr
     JOIN convoys c ON c.id = cdr.convoy_id
     WHERE c.status = 'active' AND cdr.status IN ('pending','partial')
       AND cdr.report_date >= CURRENT_DATE - INTERVAL '3 days'`,
    []
  );
  logger.info(`[convoyReport] scheduledRecount: ${active.rows.length} reports to recheck`);
  await Promise.allSettled(active.rows.map(r => recountPhotos(r.convoy_id, String(r.report_date).slice(0, 10))));
}

// ─── Worker Startup ───────────────────────────────────────────────────────────

function startConvoyReportWorker() {
  const connection = getRedisConnection();

  const reportWorker = new Worker('convoyReport', async (job) => {
    logger.info(`[convoyReport] job ${job.name} id=${job.id}`);
    if (job.name === 'checkProgress') return handleCheckProgress(job.data);
    if (job.name === 'generateReport') return handleGenerateReport(job.data);
    if (job.name === 'scheduledRecount') return handleScheduledRecount();
    logger.warn(`[convoyReport] Unknown job name: ${job.name}`);
  }, { connection });

  const archiveWorker = new Worker('convoyArchive', async (job) => {
    logger.info(`[convoyArchive] job ${job.name} id=${job.id}`);
    if (job.name === 'generateArchive') return handleGenerateArchive(job.data);
    logger.warn(`[convoyArchive] Unknown job name: ${job.name}`);
  }, { connection });

  reportWorker.on('failed', (job, err) => logger.error(`[convoyReport] job ${job?.id} failed: ${err.message}`));
  reportWorker.on('error', (err) => logger.error(`[convoyReport] worker error: ${err.message}`));
  archiveWorker.on('failed', (job, err) => logger.error(`[convoyArchive] job ${job?.id} failed: ${err.message}`));
  archiveWorker.on('error', (err) => logger.error(`[convoyArchive] worker error: ${err.message}`));

  logger.info('convoyReport + convoyArchive workers started');
  return [reportWorker, archiveWorker];
}

module.exports = { startConvoyReportWorker, recountPhotos, handleGenerateReport };

// Run standalone
if (require.main === module) {
  const { createQueues } = require('../config/queue');
  createQueues();
  const workers = startConvoyReportWorker();
  const shutdown = async () => {
    await Promise.all(workers.map((w) => w.close()));
    await pool.end();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
