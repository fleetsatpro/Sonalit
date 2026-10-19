#!/usr/bin/env node
'use strict';

/**
 * Read-only Sonalit storage inventory.
 *
 * Usage (from repository root, after the target DB is healthy):
 *   node backend/scripts/storage-audit.js
 *   node backend/scripts/storage-audit.js --payload-scan
 *   node backend/scripts/storage-audit.js --scan-r2
 *   node backend/scripts/storage-audit.js --payload-scan --scan-r2 --max-objects=10000
 *   ANALYTICS_DATABASE_URL=... node backend/scripts/storage-audit.js --analytics
 *
 * DATABASE_URL and ANALYTICS_DATABASE_URL are read-only connection inputs.
 * R2 inventory only lists object metadata. It never downloads object bodies or prints keys.
 * The script never writes to PostgreSQL or R2.
 */

const { Pool } = require('pg');

try {
  require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
} catch (_) {
  // dotenv is optional when env is injected by a deployment/secure shell.
}

const argv = new Set(process.argv.slice(2).filter((arg) => !arg.startsWith('--max-objects=')));
const maxArg = process.argv.slice(2).find((arg) => arg.startsWith('--max-objects='));
const maxObjects = maxArg ? Number(maxArg.split('=')[1]) : 10000;

if (!Number.isInteger(maxObjects) || maxObjects < 1 || maxObjects > 100000) {
  console.error('--max-objects must be an integer from 1 to 100000');
  process.exit(2);
}

const payloadScan = argv.has('--payload-scan');
const scanR2 = argv.has('--scan-r2');
const includeAnalytics = argv.has('--analytics');
const selectedDb = includeAnalytics ? process.env.ANALYTICS_DATABASE_URL : process.env.DATABASE_URL;
const selectedDbLabel = includeAnalytics ? 'analytics' : 'primary';

function bytes(n) {
  const value = Number(n || 0);
  if (!Number.isFinite(value) || value < 0) return 'unknown';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let size = value;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index++;
  }
  return `${size.toFixed(index === 0 ? 0 : 2)} ${units[index]}`;
}

function print(title, value) {
  console.log(`\n## ${title}\n${JSON.stringify(value, null, 2)}`);
}

async function tableExists(client, tableName, columnName) {
  const q = await client.query(
    'SELECT 1 FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 AND column_name = $3 LIMIT 1',
    ['public', tableName, columnName],
  );
  return q.rowCount > 0;
}

async function scanPayloads(client) {
  const candidates = [
    {
      table: 'field_reports',
      column: 'photo_url',
      where: "photo_url LIKE 'data:%'",
      kind: 'inline_data_uri',
      sql: "SELECT COUNT(*)::bigint AS rows, COALESCE(SUM(pg_column_size(photo_url)),0)::bigint AS bytes FROM public.field_reports WHERE photo_url LIKE 'data:%'",
    },
    {
      table: 'convoy_truck_photos',
      column: 'photo_url',
      where: "photo_url LIKE 'data:%'",
      kind: 'inline_data_uri',
      sql: "SELECT COUNT(*)::bigint AS rows, COALESCE(SUM(pg_column_size(photo_url)),0)::bigint AS bytes FROM public.convoy_truck_photos WHERE photo_url LIKE 'data:%'",
    },
    {
      table: 'convoy_daily_reports',
      column: 'pdf_data',
      kind: 'bytea_pdf',
      sql: "SELECT COUNT(*) FILTER (WHERE pdf_data IS NOT NULL)::bigint AS rows, COALESCE(SUM(octet_length(pdf_data)),0)::bigint AS bytes FROM public.convoy_daily_reports",
    },
    {
      table: 'guardian_voice_messages',
      column: 'audio',
      kind: 'bytea_audio',
      sql: "SELECT COUNT(*)::bigint AS rows, COALESCE(SUM(octet_length(audio)),0)::bigint AS bytes FROM public.guardian_voice_messages",
    },
  ];
  const results = [];
  for (const item of candidates) {
    if (!(await tableExists(client, item.table, item.column))) {
      results.push({ table: item.table, column: item.column, kind: item.kind, status: 'column_not_present' });
      continue;
    }
    const result = await client.query(item.sql);
    const row = result.rows[0];
    results.push({
      table: item.table,
      column: item.column,
      kind: item.kind,
      status: 'measured',
      rows: Number(row.rows || 0),
      bytes: Number(row.bytes || 0),
      humanBytes: bytes(row.bytes),
    });
  }
  return results;
}

async function auditDatabase(connectionString, label) {
  if (!connectionString) {
    return { label, status: 'skipped', reason: label === 'analytics'
      ? 'ANALYTICS_DATABASE_URL is not set'
      : 'DATABASE_URL is not set' };
  }
  const pool = new Pool({
    connectionString,
    max: 1,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 1000,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
    application_name: 'sonalit_storage_audit_readonly',
  });
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN TRANSACTION READ ONLY');
    const db = await client.query(
      'SELECT current_database() AS database_name, current_timestamp AS measured_at, pg_database_size(current_database())::bigint AS database_bytes',
    );
    const relations = await client.query(
      `SELECT s.schemaname, s.relname AS relation_name, s.n_live_tup::bigint AS estimated_live_rows,
              s.n_dead_tup::bigint AS estimated_dead_rows,
              pg_total_relation_size(format('%I.%I', s.schemaname, s.relname)::regclass)::bigint AS total_bytes,
              pg_relation_size(format('%I.%I', s.schemaname, s.relname)::regclass)::bigint AS heap_bytes,
              pg_indexes_size(format('%I.%I', s.schemaname, s.relname)::regclass)::bigint AS index_bytes
         FROM pg_stat_user_tables s
        ORDER BY pg_total_relation_size(format('%I.%I', s.schemaname, s.relname)::regclass) DESC
        LIMIT 40`,
    );
    const candidateColumns = await client.query(
      `SELECT c.table_schema, c.table_name, c.column_name, c.data_type, c.udt_name
         FROM information_schema.columns c
         JOIN information_schema.tables t
           ON t.table_schema=c.table_schema AND t.table_name=c.table_name
        WHERE c.table_schema='public' AND t.table_type='BASE TABLE'
          AND (c.data_type='bytea' OR c.column_name ILIKE ANY(ARRAY[
            '%photo%', '%pdf%', '%audio%', '%file%', '%image%', '%attachment%', '%storage_key%', '%object_key%'
          ]))
        ORDER BY c.table_name, c.ordinal_position`,
    );
    const partitions = await client.query(
      `SELECT pn.nspname AS schema_name, p.relname AS parent_table, ch.relname AS partition_name,
              pg_get_expr(ch.relpartbound, ch.oid) AS partition_bound,
              pg_total_relation_size(ch.oid)::bigint AS partition_bytes
         FROM pg_inherits i
         JOIN pg_class p ON p.oid=i.inhparent
         JOIN pg_namespace pn ON pn.oid=p.relnamespace
         JOIN pg_class ch ON ch.oid=i.inhrelid
        WHERE pn.nspname='public'
        ORDER BY p.relname,ch.relname`,
    );
    const retention = await client.query(
      `SELECT to_regclass('public.partition_retention')::text AS partition_retention_table,
              to_regclass('public.guardian_config')::text AS guardian_config_table`,
    );
    const payloads = payloadScan ? await scanPayloads(client) : null;
    await client.query('COMMIT');
    return {
      label,
      status: 'ok',
      database: {
        name: db.rows[0].database_name,
        measuredAt: db.rows[0].measured_at,
        bytes: Number(db.rows[0].database_bytes),
        humanBytes: bytes(db.rows[0].database_bytes),
      },
      largestRelations: relations.rows.map((r) => ({
        ...r,
        estimated_live_rows: Number(r.estimated_live_rows),
        estimated_dead_rows: Number(r.estimated_dead_rows),
        total_bytes: Number(r.total_bytes),
        heap_bytes: Number(r.heap_bytes),
        index_bytes: Number(r.index_bytes),
        humanTotal: bytes(r.total_bytes),
      })),
      storageCandidateColumns: candidateColumns.rows,
      partitions: partitions.rows.map((p) => ({
        ...p,
        partition_bytes: Number(p.partition_bytes),
        humanBytes: bytes(p.partition_bytes),
      })),
      retentionCatalog: retention.rows[0],
      payloadMeasurements: payloads,
    };
  } catch (error) {
    if (client) {
      try { await client.query('ROLLBACK'); } catch (_) {}
    }
    return {
      label,
      status: 'error',
      error: String(error.message || error).slice(0, 600),
      hint: 'Audit only a healthy/recovered database. This failure does not authorize recovery writes.',
    };
  } finally {
    if (client) client.release();
    await pool.end();
  }
}

async function auditR2() {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY;
  const secretAccessKey = process.env.R2_SECRET_KEY;
  if (!(accountId && accessKeyId && secretAccessKey)) {
    return { status: 'skipped', reason: 'R2 account credentials not configured in the environment; no credentials were printed' };
  }
  let sdk;
  try {
    sdk = require('@aws-sdk/client-s3');
  } catch (_) {
    return { status: 'skipped', reason: '@aws-sdk/client-s3 is not installed in this package' };
  }
  const bucketNames = [
    process.env.R2_MEDIA_BUCKET,
    process.env.R2_PRIVATE_EVIDENCE_BUCKET,
    process.env.R2_PRIVATE_REPORTS_BUCKET,
    process.env.R2_ARCHIVE_BUCKET,
    process.env.R2_REPORTS_BUCKET,
    process.env.R2_BUCKET,
  ].filter(Boolean);
  const uniqueBuckets = [...new Set(bucketNames)];
  if (!uniqueBuckets.length) return { status: 'skipped', reason: 'No R2 bucket names configured' };

  const client = new sdk.S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
    maxAttempts: 3,
  });
  const results = [];
  try {
    for (const bucket of uniqueBuckets) {
      let token;
      let count = 0;
      let totalBytes = 0;
      let oldest = null;
      let newest = null;
      let truncated = false;
      const prefixes = new Map();
      do {
        const page = await client.send(new sdk.ListObjectsV2Command({
          Bucket: bucket,
          ContinuationToken: token,
          MaxKeys: Math.min(1000, maxObjects - count),
        }));
        for (const object of page.Contents || []) {
          count++;
          totalBytes += Number(object.Size || 0);
          if (object.LastModified) {
            const stamp = new Date(object.LastModified).toISOString();
            if (!oldest || stamp < oldest) oldest = stamp;
            if (!newest || stamp > newest) newest = stamp;
          }
          // Only aggregate the first key segment. Never display object keys.
          const key = String(object.Key || '');
          const segment = key.includes('/') ? key.slice(0, key.indexOf('/')) : '(root)';
          const entry = prefixes.get(segment) || { objects: 0, bytes: 0 };
          entry.objects++;
          entry.bytes += Number(object.Size || 0);
          prefixes.set(segment, entry);
          if (count >= maxObjects && page.IsTruncated) {
            truncated = true;
            break;
          }
        }
        if (count >= maxObjects || !page.IsTruncated) break;
        token = page.NextContinuationToken;
      } while (token);
      results.push({
        bucket,
        objectsEnumerated: count,
        totalBytes: count ? totalBytes : 0,
        humanBytes: bytes(totalBytes),
        oldestObjectLastModified: oldest,
        newestObjectLastModified: newest,
        truncatedAtLimit: truncated,
        prefixes: [...prefixes.entries()]
          .map(([prefix, value]) => ({ prefix, objects: value.objects, bytes: value.bytes, humanBytes: bytes(value.bytes) }))
          .sort((a, b) => b.bytes - a.bytes)
          .slice(0, 30),
      });
    }
    return {
      status: 'ok',
      note: 'Metadata-only bounded listing; object bodies and individual keys are never printed. Values represent only the enumerated objects if truncated.',
      maxObjectsPerBucket: maxObjects,
      buckets: results,
    };
  } finally {
    client.destroy();
  }
}

(async () => {
  print('Storage audit settings', {
    databaseTarget: selectedDbLabel,
    payloadScanEnabled: payloadScan,
    r2ScanEnabled: scanR2,
    maxObjectsPerBucket: maxObjects,
    readOnly: true,
  });
  const dbResult = await auditDatabase(selectedDb, selectedDbLabel);
  print(`PostgreSQL ${selectedDbLabel}`, dbResult);
  if (scanR2) print('R2 object metadata inventory', await auditR2());
  if (dbResult.status === 'error') process.exitCode = 1;
})().catch((error) => {
  console.error('Storage audit failed:', String(error.message || error).slice(0, 600));
  process.exitCode = 1;
});
