/*
 * Sonalit runtime fencing.
 *
 * Exactly one production runtime may own the active role at a time. Railway
 * remains the primary; the Docker standby starts with SONALIT_STANDBY=true and
 * therefore never claims the fence. Promotion sets SONALIT_FENCE_TAKEOVER=true
 * only after the primary has been fenced/offline.
 *
 * The claim runs synchronously in a child Node process BEFORE app.js is loaded.
 * That means active cron registration, workers, routes and HTTP listeners cannot
 * start until the process owns the authoritative PostgreSQL runtime lease.
 */
const os = require("os");
const crypto = require("crypto");
const { spawnSync } = require("child_process");
const { Client } = require("pg");

const isClaimChild = process.argv.includes("--claim");
const isStandby = String(process.env.SONALIT_STANDBY || "").toLowerCase() === "true";
const isProduction = String(process.env.NODE_ENV || "").toLowerCase() === "production";
const ownerId = process.env.SONALIT_RUNTIME_ID || `${os.hostname()}:${process.pid}:${crypto.randomUUID()}`;
const takeover = String(process.env.SONALIT_FENCE_TAKEOVER || "").toLowerCase() === "true";
const FENCE_STALE_SECONDS = Math.max(30, Number(process.env.SONALIT_FENCE_STALE_SECONDS || 60));
const FENCE_HEARTBEAT_MS = Math.max(10_000, Number(process.env.SONALIT_FENCE_HEARTBEAT_MS || 15_000));

async function claimInChild() {
  if (!process.env.DATABASE_URL) {
    console.error("SONALIT runtime fence: DATABASE_URL is required");
    process.exit(78);
  }

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 10_000,
    application_name: `sonalit-active-fence-claim:${ownerId}`,
  });

  try {
    await client.connect();
    await client.query(`
      CREATE TABLE IF NOT EXISTS sonalit_runtime_fence (
        id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
        owner_id TEXT,
        acquired_at TIMESTAMPTZ,
        heartbeat_at TIMESTAMPTZ
      )
    `);
    await client.query(`
      INSERT INTO sonalit_runtime_fence (id)
      VALUES (1)
      ON CONFLICT (id) DO NOTHING
    `);

    await client.query("SELECT pg_advisory_lock(hashtext('sonalit-runtime-fence'))");
    try {
      const { rows } = await client.query(`
        SELECT owner_id,
               EXTRACT(EPOCH FROM (NOW() - heartbeat_at)) AS age_seconds
        FROM sonalit_runtime_fence
        WHERE id = 1
        FOR UPDATE
      `);
      const current = rows[0] || {};
      const stale = !current.owner_id || current.age_seconds == null || Number(current.age_seconds) >= FENCE_STALE_SECONDS;

      if (current.owner_id && current.owner_id !== ownerId && !stale && !takeover) {
        console.error(`SONALIT runtime fence: active runtime ${current.owner_id} already owns the lease; refusing split-brain startup`);
        process.exitCode = 78;
        return;
      }

      if (current.owner_id && current.owner_id !== ownerId && !stale && takeover) {
        console.warn(`SONALIT runtime fence: takeover requested; replacing active owner ${current.owner_id}`);
      }

      await client.query(`
        UPDATE sonalit_runtime_fence
        SET owner_id = $1,
            acquired_at = NOW(),
            heartbeat_at = NOW()
        WHERE id = 1
      `, [ownerId]);
    } finally {
      await client.query("SELECT pg_advisory_unlock(hashtext('sonalit-runtime-fence'))");
    }
  } catch (err) {
    console.error(`SONALIT runtime fence: claim failed: ${err.message || String(err)}`);
    process.exitCode = 78;
  } finally {
    await client.end().catch(() => {});
  }
}

if (isClaimChild) {
  claimInChild().finally(() => process.exit(process.exitCode || 0));
} else if (isStandby || !isProduction || process.env.NODE_ENV === "test") {
  module.exports = { enabled: false, standby: isStandby };
} else {
  const childEnv = {
    ...process.env,
    SONALIT_RUNTIME_ID: ownerId,
    SONALIT_FENCE_TAKEOVER: takeover ? "true" : "false",
  };
  const claim = spawnSync(process.execPath, [__filename, "--claim"], {
    env: childEnv,
    stdio: "inherit",
  });

  if (claim.error || claim.status !== 0) {
    console.error(`SONALIT runtime fence: refusing application startup (claim status=${claim.status ?? "error"})`);
    process.exit(claim.status || 78);
  }

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 10_000,
    application_name: `sonalit-active-fence:${ownerId}`,
  });
  let heartbeatTimer;
  let stopping = false;

  const stopFence = async () => {
    if (stopping) return;
    stopping = true;
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    try {
      await client.query(
        "DELETE FROM sonalit_runtime_fence WHERE id = 1 AND owner_id = $1",
        [ownerId]
      );
    } catch (_) {
      // The lease has a timeout and will expire naturally if cleanup fails.
    }
    await client.end().catch(() => {});
  };

  client.on("error", err => {
    console.error(`SONALIT runtime fence: PostgreSQL connection lost: ${err.message || String(err)}`);
    process.exit(78);
  });

  client.connect()
    .then(() => {
      heartbeatTimer = setInterval(async () => {
        try {
          const { rowCount } = await client.query(`
            UPDATE sonalit_runtime_fence
            SET heartbeat_at = NOW()
            WHERE id = 1 AND owner_id = $1
          `, [ownerId]);
          if (rowCount !== 1) {
            console.error("SONALIT runtime fence: ownership was lost; terminating active runtime");
            process.exit(78);
          }
        } catch (err) {
          console.error(`SONALIT runtime fence: heartbeat failed: ${err.message || String(err)}`);
          process.exit(78);
        }
      }, FENCE_HEARTBEAT_MS);
      heartbeatTimer.unref();
      process.once("SIGTERM", () => { stopFence().finally(() => {}); });
      process.once("SIGINT", () => { stopFence().finally(() => {}); });
    })
    .catch(err => {
      console.error(`SONALIT runtime fence: heartbeat connection failed: ${err.message || String(err)}`);
      process.exit(78);
    });

  module.exports = { enabled: true, ownerId, takeover, staleSeconds: FENCE_STALE_SECONDS };
}
