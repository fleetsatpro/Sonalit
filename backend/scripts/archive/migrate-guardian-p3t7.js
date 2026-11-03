#!/usr/bin/env node
/**
 * Migration: Guardian Phase 3 Task 7 — Command signing
 *
 * Adds signature column to device_commands for HMAC-SHA256 verification.
 *
 * ROLLBACK:
 *   ALTER TABLE device_commands DROP COLUMN IF EXISTS signature;
 */

'use strict';

const { query } = require('../src/config/database');

async function up() {
  await query(`ALTER TABLE device_commands ADD COLUMN IF NOT EXISTS signature TEXT`);
  console.log('device_commands.signature column added');
}

up()
  .then(() => { console.log('Migration p3t7 complete'); process.exit(0); })
  .catch((err) => { console.error('Migration p3t7 failed:', err.message); process.exit(1); });
