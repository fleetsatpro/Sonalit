require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { checkIntelligenceSchema } = require('../src/utils/intelligenceSchemaHealth');

const RECONCILIATION_FILE = path.resolve(__dirname, '../migrations/20260908_115_intelligence_public_schema_repair.sql');

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for the intelligence schema gate');
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000,
    idleTimeoutMillis: 10000,
  });
  try {
    await pool.query('SET search_path TO public');
    const reconciliationSql = fs.readFileSync(RECONCILIATION_FILE, 'utf8');
    await pool.query(reconciliationSql);
    console.log('[intel-schema-gate] explicit public-schema repair executed on certification connection');

    const result = await checkIntelligenceSchema(pool.query.bind(pool));
    if (!result.ok) {
      console.error('[intel-schema-gate] FAILED');
      if (result.missing_tables.length) console.error('[intel-schema-gate] missing tables:', result.missing_tables.join(', '));
      if (result.missing_columns.length) console.error('[intel-schema-gate] missing columns:', result.missing_columns.join(', '));
      process.exitCode = 1;
      return;
    }
    console.log(`[intel-schema-gate] PASS — ${result.required_tables} tables and ${result.required_columns} required columns present`);
  } finally {
    await pool.end();
  }
}

main().catch(err => {
  console.error('[intel-schema-gate] ERROR:', err.message);
  process.exitCode = 1;
});
