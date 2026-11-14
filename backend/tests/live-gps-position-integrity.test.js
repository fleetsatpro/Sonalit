'use strict';

const fs = require('node:fs');
const path = require('node:path');

const read = relative => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');

describe('live GPS position integrity', () => {
  const gpsRoute = read('src/routes/gps.js');
  const gpsWorker = read('src/workers/gpsWorker.js');
  const guardian = read('src/routes/guardian.js');

  test('Guardian map position timestamp comes from the last GPS fix, not the heartbeat', () => {
    expect(gpsRoute).toMatch(/COALESCE\(dl\.timestamp,\s*gd\.last_fix_at\)\s+AS timestamp/);
    expect(gpsRoute).toMatch(/gd\.last_seen\s+AS last_seen_at/);
    expect(gpsRoute).not.toMatch(/gd\.last_seen\s+AS timestamp/);
    expect(gpsRoute).toMatch(/dl\.accuracy\s+AS accuracy_m/);
  });

  test('vehicle fixes and history are committed only when the fix is newer than the cached position', () => {
    expect(gpsWorker).toContain('last_ping IS NULL OR last_ping < $3');
    expect(gpsWorker).toContain('WITH accepted AS (');
    expect(gpsWorker).toContain('INSERT INTO gps_logs');
    expect(gpsWorker).toContain('INNER JOIN logged ON TRUE');
    expect(gpsWorker).toContain('older_than_current_fix');
  });

  test('single Guardian fixes update last_fix_at using the device-recorded timestamp', () => {
    expect(guardian).toContain('last_fix_at = CASE WHEN last_fix_at IS NULL OR last_fix_at <= $5 THEN $5 ELSE last_fix_at END');
    expect(guardian).toContain('result.rows[0].timestamp');
    expect(guardian).toContain('accuracy_m: accuracy ?? null');
  });

  test('Guardian batches are ordered by observation time and expose the recorded accuracy', () => {
    expect(guardian).toContain('const orderedPoints = points');
    expect(guardian).toContain('.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))');
    expect(guardian).toContain('lastAccuracy = pt.accuracy ?? null');
    expect(guardian).toContain('accuracy_m: lastAccuracy ?? null');
    expect(guardian).toContain('last_fix_at = CASE WHEN last_fix_at IS NULL OR last_fix_at <= $5 THEN $5 ELSE last_fix_at END');
  });
});
