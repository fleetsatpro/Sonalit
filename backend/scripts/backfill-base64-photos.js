'use strict';

/**
 * backfill-base64-photos.js
 *
 * Finds field_reports whose photo_url is a base64 data URI (data:image/jpeg;base64,…),
 * uploads the image to R2, and replaces the column with the public HTTPS URL.
 *
 * Scope: reports created in the last 7 days (older ones are too stale to matter).
 *
 * Invocation:
 *   node scripts/backfill-base64-photos.js          (manual / Railway cron)
 *   require('./scripts/backfill-base64-photos')      (app.js node-cron, daily 03:00 UTC)
 */

const { Pool } = require('pg');
const { v4: uuidv4 } = require('uuid');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

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

async function run() {
  let client;
  try {
    client = await pool.connect();

    const { rows } = await client.query(`
      SELECT id, device_id, photo_url
      FROM field_reports
      WHERE photo_url LIKE 'data:%'
        AND created_at > NOW() - INTERVAL '7 days'
      ORDER BY created_at DESC
    `);

    if (rows.length === 0) {
      console.log('[backfill-photos] Nothing to migrate.');
      return;
    }

    console.log(`[backfill-photos] Found ${rows.length} report(s) with base64 photos.`);

    let { s3, PutObjectCommand, bucket, publicBase };
    try {
      ({ s3, PutObjectCommand, bucket, publicBase } = await getR2Client());
    } catch (e) {
      console.error('[backfill-photos] R2 not configured, skipping:', e.message);
      return;
    }

    let uploaded = 0;
    let failed = 0;

    for (const row of rows) {
      try {
        const dataUri = row.photo_url;
        // data:image/jpeg;base64,<bytes>
        const match = dataUri.match(/^data:([^;]+);base64,(.+)$/s);
        if (!match) {
          console.warn(`[backfill-photos] Report ${row.id}: unexpected data URI format, skipping.`);
          failed++;
          continue;
        }
        const mimeType = match[1];
        const ext = mimeType.includes('png') ? 'png' : 'jpg';
        const imageBytes = Buffer.from(match[2], 'base64');

        const key = `reports/${row.device_id}/${uuidv4()}.${ext}`;
        await s3.send(new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: imageBytes,
          ContentType: mimeType,
        }));

        const publicUrl = `${publicBase}/${key}`;
        await client.query(
          `UPDATE field_reports SET photo_url = $1 WHERE id = $2`,
          [publicUrl, row.id]
        );
        console.log(`[backfill-photos] Report ${row.id} → ${publicUrl}`);
        uploaded++;
      } catch (e) {
        console.error(`[backfill-photos] Report ${row.id} failed: ${e.message}`);
        failed++;
      }
    }

    console.log(`[backfill-photos] Done. Uploaded: ${uploaded}, Failed: ${failed}`);
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
