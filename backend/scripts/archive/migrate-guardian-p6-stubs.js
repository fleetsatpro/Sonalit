/**
 * Guardian Phase 6 — Feature flag stubs
 *
 * Seeds guardian_config with OFF-by-default feature flags for all Phase 6
 * planned features. All default to 0 (disabled) and can be toggled without
 * a redeploy via PATCH /api/v1/guardian/config.
 *
 * Forward-only migration.
 * Rollback:
 *   DELETE FROM guardian_config WHERE key IN (
 *     'feature_qr_enrollment','feature_encrypted_token_storage',
 *     'feature_cert_pinning','feature_command_signing',
 *     'feature_convoy_code_validation','feature_fcm_push',
 *     'feature_batch_location','feature_presigned_photos',
 *     'feature_socket_redis_adapter','feature_multi_tenancy',
 *     'feature_gdpr_endpoints','feature_dead_mans_switch_server_config',
 *     'feature_audit_log','feature_prometheus_metrics'
 *   );
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { pool } = require('../src/config/database');

const FLAGS = [
  ['feature_qr_enrollment',            0, 'QR code enrollment codes (requires ZXing on APK)'],
  ['feature_encrypted_token_storage',  1, 'Android KeyStore AES-GCM encrypted device token (APK >= 2.4)'],
  ['feature_cert_pinning',             0, 'TLS certificate pinning on APK (set cert_pin_sha256 to enable)'],
  ['feature_command_signing',          0, 'HMAC-SHA256 signed commands (requires COMMAND_SIGNING_SECRET env)'],
  ['feature_convoy_code_validation',   1, 'Validate convoy codes against convoy_codes table'],
  ['feature_fcm_push',                 0, 'Firebase Cloud Messaging push notifications (requires FIREBASE_PROJECT_ID)'],
  ['feature_batch_location',           0, 'Batch GPS upload endpoint /location/batch'],
  ['feature_presigned_photos',         0, 'Presigned S3/R2 URL photo uploads (requires S3_BUCKET env)'],
  ['feature_socket_redis_adapter',     1, 'Socket.IO Redis pub/sub adapter (requires REDIS_URL env)'],
  ['feature_multi_tenancy',            0, 'Enforce org_id isolation on guardian routes'],
  ['feature_gdpr_endpoints',           1, 'GDPR data export and purge endpoints'],
  ['feature_dead_mans_switch_server_config', 1, 'DMS interval configurable from server via /config endpoint'],
  ['feature_audit_log',                1, 'Guardian audit log for admin actions'],
  ['feature_prometheus_metrics',       1, 'Enhanced /metrics endpoint with guardian KPIs'],
];

async function run() {
  const client = await pool.connect();
  try {
    console.log('[p6-stubs] Seeding feature flags into guardian_config');
    await client.query('BEGIN');

    for (const [key, value_int, description] of FLAGS) {
      await client.query(
        `INSERT INTO guardian_config (key, value_int, description)
         VALUES ($1, $2, $3)
         ON CONFLICT (key) DO NOTHING`,
        [key, value_int, description]
      );
      console.log(`[p6-stubs] ${key} = ${value_int} (${value_int ? 'ON' : 'OFF'})`);
    }

    await client.query('COMMIT');
    console.log('[p6-stubs] Done — all feature flags seeded.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[p6-stubs] FAILED:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
