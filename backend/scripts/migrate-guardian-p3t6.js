#!/usr/bin/env node
/**
 * Migration: Guardian Phase 3 Task 6 — Convoy code security
 *
 * Creates convoy_codes table for managed convoy access control.
 *
 * ROLLBACK:
 *   DROP TABLE IF EXISTS convoy_codes;
 */

'use strict';

const { query } = require('../src/config/database');

async function up() {
  await query(`
    CREATE TABLE IF NOT EXISTS convoy_codes (
      code        TEXT PRIMARY KEY,
      created_by  UUID REFERENCES users(id),
      org_id      UUID,
      max_members INT DEFAULT 50,
      expires_at  TIMESTAMPTZ,
      active      BOOLEAN DEFAULT true,
      created_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  console.log('convoy_codes table created');
}

up()
  .then(() => { console.log('Migration p3t6 complete'); process.exit(0); })
  .catch((err) => { console.error('Migration p3t6 failed:', err.message); process.exit(1); });
