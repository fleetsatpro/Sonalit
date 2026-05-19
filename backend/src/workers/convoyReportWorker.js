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
  const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
  const s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: R2_ACCESS_KEY, secretAccessKey: R2_SECRET_KEY },
  });
  await s3.send(new PutObjectCommand({ Bucket: R2_BUCKET, Key: key, Body: buffer, ContentType: contentType }));
  return `${R2_PUBLIC_URL || `https://${R2_BUCKET}.${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`}/${key}`;
}

// ─── DB Helpers ───────────────────────────────────────────────────────────────

async function fetchReportData(convoy_id, report_date) {
  const [convoyRes, trucksRes, cfosRes, photosRes, reportRes] = await Promise.all([
    query('SELECT * FROM convoys WHERE id = $1', [convoy_id]),
    query('SELECT * FROM convoy_trucks WHERE convoy_id = $1 ORDER BY position', [convoy_id]),
    query(
      `SELECT cc.*, u.name AS cfo_name, u.email AS cfo_email
       FROM convoy_cfos cc JOIN users u ON u.id = cc.cfo_user_id
       WHERE cc.convoy_id = $1`,
      [convoy_id]
    ),
    query(
      `SELECT * FROM convoy_truck_photos WHERE convoy_id = $1 AND report_date = $2`,
      [convoy_id, report_date]
    ),
    query(
      `SELECT * FROM convoy_daily_reports WHERE convoy_id = $1 AND report_date = $2`,
      [convoy_id, report_date]
    ),
  ]);
  return {
    convoy: convoyRes.rows[0],
    trucks: trucksRes.rows,
    cfos: cfosRes.rows,
    photos: photosRes.rows,
    report: reportRes.rows[0],
  };
}

async function recountPhotos(convoy_id, report_date) {
  const truckCountRes = await query(
    `SELECT COUNT(ct.id) AS truck_count, c.seal_count_per_truck
     FROM convoys c JOIN convoy_trucks ct ON ct.convoy_id = c.id
     WHERE c.id = $1
     GROUP BY c.seal_count_per_truck`,
    [convoy_id]
  );
  if (!truckCountRes.rows.length) return;

  const { truck_count, seal_count_per_truck } = truckCountRes.rows[0];
  const required = parseInt(truck_count) * (2 + parseInt(seal_count_per_truck)) * 2;

  const recvRes = await query(
    `SELECT COUNT(*) AS received FROM convoy_truck_photos WHERE convoy_id = $1 AND report_date = $2`,
    [convoy_id, report_date]
  );
  const received = parseInt(recvRes.rows[0].received);
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

async function handleGenerateReport({ convoy_id, report_date }) {
  const { convoy, trucks, cfos, photos, report } = await fetchReportData(convoy_id, report_date);
  if (!convoy) throw new Error(`Convoy ${convoy_id} not found`);
  if (!report) {
    logger.warn(`[convoyReport] No daily report row for ${convoy_id} ${report_date} — running recount`);
    await recountPhotos(convoy_id, report_date);
    return;
  }
  if (report.status === 'generated') {
    logger.info(`[convoyReport] ${convoy_id} ${report_date} already generated — skipping`);
    return;
  }

  const pdfBuffer = await generateDailyReport(convoy, trucks, cfos, photos, report, report_date);
  const key = `reports/daily/${convoy_id}/${report_date}.pdf`;

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

  const crypto = require('crypto');
  const contentHash = crypto.createHash('sha256').update(pdfBuffer).digest('hex');

  await query(
    `UPDATE convoy_daily_reports
     SET status = 'generated', pdf_url = $1, content_hash = $2,
         generation_error = $3, generated_at = NOW(), updated_at = NOW()
     WHERE convoy_id = $4 AND report_date = $5`,
    [pdfUrl, contentHash, generationError, convoy_id, report_date]
  );
  logger.info(`[convoyReport] report marked generated for ${convoy_id}/${report_date}`);
}

async function handleGenerateArchive({ convoy_id }) {
  const convoy = (await query('SELECT * FROM convoys WHERE id = $1', [convoy_id])).rows[0];
  if (!convoy) throw new Error(`Convoy ${convoy_id} not found`);

  const [trucks, cfos, reports, allPhotos] = await Promise.all([
    query('SELECT * FROM convoy_trucks WHERE convoy_id = $1 ORDER BY position', [convoy_id]),
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
  const key = `reports/archive/${convoy_id}/archive.pdf`;

  const pdfUrl = await uploadToR2(key, pdfBuffer, 'application/pdf');

  await query(
    `UPDATE convoys SET archive_pdf_url = $1, updated_at = NOW() WHERE id = $2`,
    [pdfUrl, convoy_id]
  );
  logger.info(`[convoyArchive] Archive PDF generated: ${pdfUrl}`);
}

// ─── Worker Startup ───────────────────────────────────────────────────────────

function startConvoyReportWorker() {
  const connection = getRedisConnection();

  const reportWorker = new Worker('convoyReport', async (job) => {
    logger.info(`[convoyReport] job ${job.name} id=${job.id}`);
    if (job.name === 'checkProgress') return handleCheckProgress(job.data);
    if (job.name === 'generateReport') return handleGenerateReport(job.data);
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

module.exports = { startConvoyReportWorker };

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
