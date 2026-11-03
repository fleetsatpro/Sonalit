'use strict';

/**
 * backfill-base64-photos.js
 *
 * Finds rows in field_reports and convoy_truck_photos whose photo_url is a
 * base64 data URI (data:image/jpeg;base64,…), uploads the image to R2, and
 * replaces the column with the public HTTPS URL.
 *
 * Scope: records created in the last 7 days (older ones are too stale to matter).
 *
 * Invocation:
 *   node scripts/backfill-base64-photos.js          (manual / Railway cron)
 *   require('./scripts/backfill-base64-photos')      (app.js node-cron, daily 03:00 UTC)
 */

const { Pool } = require('pg');
const { v4: uuidv4 } = require('uuid');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
pool.on('error', (err) => console.error('[backfill-photos] pool error:', err.message));

async function getR2Client() {
  const {
    R2_ACCOUNT_ID, R2_ACCESS_KEY, R2_SECRET_KEY,
    R2_BUCKET, R2_PUBLIC_URL,
  } = process.env;

  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY || !R2_SECRET_KEY || !R2_BUCKET) {
    throw new Error('R2 env vars not set (R2_ACCOUNT_ID, R2_ACCESS_KEY, R2_SECRET_KEY, R2_BUCKET)');
  }

  const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
  const s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: R2_ACCESS_KEY, secretAccessKey: R2_SECRET_KEY },
  });
  const bucket = R2_BUCKET;
  const publicBase = R2_PUBLIC_URL || `https://${R2_BUCKET}.${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;

  return { s3, PutObjectCommand, bucket, publicBase };
}

async function migrateRows({ client, s3, PutObjectCommand, bucket, publicBase, rows, table, keyPrefix, updateSql }) {
  let uploaded = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      const match = row.photo_url.match(/^data:([^;]+);base64,(.+)$/s);
      if (!match) {
        console.warn(`[backfill-photos] ${table} ${row.id}: unexpected data URI format, skipping.`);
        failed++;
        continue;
      }
      const mimeType = match[1];
      const ext = mimeType.includes('png') ? 'png' : 'jpg';
      const imageBytes = Buffer.from(match[2], 'base64');

      const key = `${keyPrefix(row)}/${uuidv4()}.${ext}`;
      await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: imageBytes, ContentType: mimeType }));

      const publicUrl = `${publicBase}/${key}`;
      await client.query(updateSql, [publicUrl, row.id]);
      console.log(`[backfill-photos] ${table} ${row.id} → ${publicUrl}`);
      uploaded++;
    } catch (e) {
      console.error(`[backfill-photos] ${table} ${row.id} failed: ${e.message}`);
      failed++;
    }
  }
  return { uploaded, failed };
}

async function run() {
  if (!process.env.DATABASE_URL) {
    console.warn('[backfill-photos] DATABASE_URL not set — skipping');
    return;
  }
  let client;
  try {
    client = await pool.connect();

    const [reportRows, cfoRows] = await Promise.all([
      client.query(`
        SELECT id, device_id, photo_url
        FROM field_reports
        WHERE photo_url LIKE 'data:%'
          AND created_at > NOW() - INTERVAL '7 days'
        ORDER BY created_at DESC
      `).then(r => r.rows),
      client.query(`
        SELECT id, guardian_device_id AS device_id, convoy_id, photo_url
        FROM convoy_truck_photos
        WHERE photo_url LIKE 'data:%'
          AND created_at > NOW() - INTERVAL '7 days'
        ORDER BY created_at DESC
      `).then(r => r.rows),
    ]);

    const total = reportRows.length + cfoRows.length;
    if (total === 0) {
      console.log('[backfill-photos] Nothing to migrate.');
      return;
    }
    console.log(`[backfill-photos] Found ${reportRows.length} field report(s) and ${cfoRows.length} CFO photo(s) with base64 data.`);

    let r2;
    try {
      r2 = await getR2Client();
    } catch (e) {
      console.error('[backfill-photos] R2 not configured, skipping:', e.message);
      return;
    }
    const { s3, PutObjectCommand, bucket, publicBase } = r2;

    const [rStats, cStats] = await Promise.all([
      migrateRows({
        client, s3, PutObjectCommand, bucket, publicBase,
        rows: reportRows,
        table: 'field_reports',
        keyPrefix: row => `reports/${row.device_id}`,
        updateSql: 'UPDATE field_reports SET photo_url = $1 WHERE id = $2',
      }),
      migrateRows({
        client, s3, PutObjectCommand, bucket, publicBase,
        rows: cfoRows,
        table: 'convoy_truck_photos',
        keyPrefix: row => `cfo/${row.convoy_id}/${row.device_id}`,
        updateSql: 'UPDATE convoy_truck_photos SET photo_url = $1 WHERE id = $2',
      }),
    ]);

    console.log(
      `[backfill-photos] Done. field_reports: ${rStats.uploaded} uploaded, ${rStats.failed} failed. ` +
      `convoy_truck_photos: ${cStats.uploaded} uploaded, ${cStats.failed} failed.`
    );
  } catch (err) {
    console.error('[backfill-photos] Fatal error:', err.message);
    process.exitCode = 1;
  } finally {
    if (client) client.release();
    await pool.end();
  }
}

if (require.main === module) {
  run();
} else {
  module.exports = { run };
}
