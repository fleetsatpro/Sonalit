/**
 * Runs every migration in order. Each step is wrapped so a single failure
 * does not abort the whole chain — the error is logged and the next script runs.
 * Safe to re-run on every deploy (all scripts are idempotent).
 */
require('dotenv').config();

if (!process.env.DATABASE_URL) {
  console.warn('[migrate-all] DATABASE_URL not set — skipping migrations');
  process.exit(0);
}

// Hard 90-second deadline so a hung migration never blocks server startup.
setTimeout(() => {
  console.warn('[migrate-all] 90s timeout reached — forcing exit so server can start');
  process.exit(0);
}, 90_000).unref();

const steps = [
  'migrate.js',
  'migrate-extended.js',
  'migrate-enterprise.js',
  'migrate-guardian-devices.js',   // must precede p1 (p1 FK-references guardian_devices)
  'migrate-guardian-cfo-p1.js',
  'migrate-guardian-cfo-p2.js',
  'migrate-guardian-cfo-p3.js',
  'migrate-convoy-trucks-fix.js',  // drops NOT NULL on convoy_trucks.vehicle_id
  'migrate-roles.js',
  'migrate-enable-cfo.js',
  // T6.1: numbered SQL migrations applied via the sequential runner
  'db-migrate.js',
];

(async () => {
  let failed = 0;
  for (const step of steps) {
    try {
      console.log(`[migrate-all] Running ${step}…`);
      // Re-require each script in its own module scope
      delete require.cache[require.resolve('./' + step)];
      // Each script exports nothing — it runs on require and calls process.exit on error.
      // To avoid process.exit killing us, we spawn them as child processes instead.
      await new Promise((resolve, reject) => {
        const { spawn } = require('child_process');
        const child = spawn(process.execPath, [require.resolve('./' + step)], {
          stdio: 'inherit',
          env: process.env,
        });
        child.on('close', code => {
          if (code === 0) resolve();
          else reject(new Error(`${step} exited with code ${code}`));
        });
        child.on('error', reject);
      });
      console.log(`[migrate-all] ✓ ${step}`);
    } catch (err) {
      console.error(`[migrate-all] ✗ ${step}: ${err.message}`);
      failed++;
    }
  }
  if (failed > 0) {
    console.warn(`[migrate-all] Completed with ${failed} failure(s) — check logs above`);
  } else {
    console.log('[migrate-all] All migrations completed successfully');
  }
  process.exit(failed > 0 ? 1 : 0);
})();
