'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { checkIntelligenceSchema } = require('../src/utils/intelligenceSchemaHealth');

const RECONCILIATION_FILE = path.resolve(__dirname, '../migrations/20260908_115_intelligence_public_schema_repair.sql');

function logMissing(result) {
  if (result.missing_tables.length) console.error('[intel-schema-gate] missing tables:', result.missing_tables.join(', '));
  if (result.missing_columns.length) console.error('[intel-schema-gate] missing columns:', result.missing_columns.join(', '));
  if (result.missing_indexes.length) console.error('[intel-schema-gate] missing indexes:', result.missing_indexes.join(', '));
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for the intelligence schema gate');
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000,
    idleTimeoutMillis: 10000,
  });
  let client;
  try {
    client = await pool.connect();
    await client.query('SET search_path TO public');

    let result = await checkIntelligenceSchema(client.query.bind(client));
    if (result.ok) {
      console.log(
        `[intel-schema-gate] PASS — ${result.required_tables} tables, ${result.required_columns} columns and ${result.required_indexes} indexes present; repair DDL skipped`
      );
      return;
    }

    console.warn('[intel-schema-gate] schema drift detected; attempting bounded public-schema repair');
    logMissing(result);
    const reconciliationSql = fs.readFileSync(RECONCILIATION_FILE, 'utf8');

    await client.query('BEGIN');
    try {
      // If required repair locks are busy, abort quickly and retry after traffic drains.
      await client.query("SET LOCAL lock_timeout = '8s'");
      await client.query("SET LOCAL statement_timeout = '120s'");
      await client.query(reconciliationSql);
      await client.query('COMMIT');
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch (_) {}
      throw err;
    }

    result = await checkIntelligenceSchema(client.query.bind(client));
    if (!result.ok) {
      console.error('[intel-schema-gate] repair executed but schema certification still fails');
      logMissing(result);
      throw new Error('Intelligence schema repair did not satisfy the required public schema contract');
    }
    console.log(
      `[intel-schema-gate] PASS — repaired and certified ${result.required_tables} tables, ${result.required_columns} columns and ${result.required_indexes} indexes`
    );
  } finally {
    if (client) client.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error('[intel-schema-gate] ERROR:', err.message);
  process.exitCode = 1;
});
