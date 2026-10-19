'use strict';

const fs = require('fs');
const path = require('path');

describe('idempotency fingerprint schema', () => {
  test('adds request fingerprints without rewriting legacy receipts', () => {
    const migration = fs.readFileSync(
      path.join(__dirname, '../migrations/20261019_002_idempotency_request_fingerprint.sql'),
      'utf8',
    );
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS request_hash CHAR(64)');
    expect(migration).toContain('Existing receipts retain NULL fingerprints');
  });

  test('claims bind method, URL and body and unknown outcomes cannot be reclaimed', () => {
    const middleware = fs.readFileSync(
      path.join(__dirname, '../src/middleware/idempotency.js'),
      'utf8',
    );
    expect(middleware).toContain('request_hash = EXCLUDED.request_hash');
    expect(middleware).toContain('idempotency_keys.status_code <> $3');
    expect(middleware).toContain("expires_at = 'infinity'::timestamptz");
    expect(middleware).toContain('idempotency_key_reused_for_different_request');
    expect(middleware).toContain('idempotency_outcome_unknown');
    expect(middleware).not.toContain('DELETE FROM idempotency_keys');
  });
});
