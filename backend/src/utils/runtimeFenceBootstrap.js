/*
 * Sonalit runtime fencing.
 *
 * Exactly one production runtime may own the active role at a time. Railway
 * remains the primary; the Docker standby starts with SONALIT_STANDBY=true and
 * therefore never claims the fence. When a standby is promoted, it can set
 * SONALIT_FENCE_TAKEOVER=true after the primary has been fenced/offline.
 *
 * The lease is stored in the authoritative PostgreSQL database so a process
 * restart, host replacement, or provider switch does not create a second
 * independent control plane. Active processes heartbeat the lease and exit if
 * another runtime takes ownership.
 */
const os = require("os");
const crypto = require("crypto");
const http = require("http");
const { Client } = require("pg");

const isStandby = String(process.env.SONALIT_STANDBY || "").toLowerCase() === "true";
const isProduction = String(process.env.NODE_ENV || "").toLowerCase() === "production";

if (!isStandby && isProduction && !process.env.DATABASE_URL) {
  console.error("SONALIT runtime fence: DATABASE_URL is required for an active production runtime");
  process.exit(78);
}

if (isStandby || !isProduction || process.env.NODE_ENV === "test") {
  module.exports = { enabled: false };
} else {
  const FENCE_STALE_SECONDS = Math.max(30, Number(process.env.SONALIT_FENCE_STALE_SECONDS || 60));
  const FENCE_HEARTBEAT_MS = Math.max(10_000, Number(process.env.SONALIT_FENCE_HEARTBEAT_MS || 15_000));
  const ownerId = process.env.SONALIT_RUNTIME_ID || `${os.hostname()}:${process.pid}:${crypto.randomUUID()}`;
  const takeover = String(process.env.SONALIT_FENCE_TAKEOVER || "").toLowerCase() === "true";
  let client;
  let heartbeatTimer;
  let claimed = false;
  let claimInFlight = false;
  let originalListen;

  function fatal(message, err) {
    const suffix = err ? `: ${err.message || String(err)}` : "";
    console.error(`SONALIT runtime fence: ${message}${suffix}`);
    try { if (heartbeatTimer) clearInterval(heartbeatTimer); } catch (_) {}
    try { if (client) client.end().catch(() => {}); } catch (_) {}
    process.exit(78);
  }

  async function claimFence() {
    if (claimInFlight) return;
    claimInFlight = true;
    client = new Client({
      connectionString: process.env.DATABASE_URL,
      connectionTimeoutMillis: 10_000,
      application_name: `sonalit-active-fence:${ownerId}`,
    });

    client.on("error", err => fatal("PostgreSQL fence connection lost", err));
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

    // Serialize claims. The advisory lock is only held for the transaction;
    // the durable ownership is represented by the lease row + heartbeat.
    await client.query("SELECT pg_advisory_lock(hashtext('sonalit-runtime-fence'))");
    try {
      const { rows } = await client.query(`
        SELECT owner_id, heartbeat_at,
               EXTRACT(EPOCH FROM (NOW() - heartbeat_at)) AS age_seconds
        FROM sonalit_runtime_fence
        WHERE id = 1
        FOR UPDATE
      `);
      const current = rows[0] || {};
      const stale = !current.owner_id || !current.heartbeat_at || Number(current.age_seconds) >= FENCE_STALE_SECONDS;

      if (current.owner_id && current.owner_id !== ownerId && !stale && !takeover) {
        fatal(`active runtime already fenced by ${current.owner_id}; refusing split-brain startup`);
      }

      if (current.owner_id && current.owner_id !== ownerId && !stale && takeover) {
        console.warn(`SONALIT runtime fence: takeover requested; replacing active owner ${current.owner_id}`);
      }

      await client.query(`
        UPDATE sonalit_runtime_fence
        SET owner_id = $1,
            acquired_at = COALESCE(acquired_at, NOW()),
            heartbeat_at = NOW()
        WHERE id = 1
      `, [ownerId]);
      claimed = true;
    } finally {
      await client.query("SELECT pg_advisory_unlock(hashtext('sonalit-runtime-fence'))");
    }

    heartbeatTimer = setInterval(async () => {
      try {
        if (!claimed || !client) return;
        const { rowCount } = await client.query(`
          UPDATE sonalit_runtime_fence
          SET heartbeat_at = NOW()
          WHERE id = 1 AND owner_id = $1
        `, [ownerId]);
        if (rowCount !== 1) fatal("active fence ownership was lost; terminating runtime");
      } catch (err) {
        fatal("fence heartbeat failed", err);
      }
    }, FENCE_HEARTBEAT_MS);
    heartbeatTimer.unref();

    const release = async () => {
      try {
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        if (client && claimed) {
          await client.query("DELETE FROM sonalit_runtime_fence WHERE id = 1 AND owner_id = $1", [ownerId]);
        }
      } catch (_) {
        // Lease will expire naturally if cleanup cannot complete.
      } finally {
        try { await client?.end(); } catch (_) {}
      }
    };
    process.once("SIGTERM", () => { release().finally(() => {}); });
    process.once("SIGINT", () => { release().finally(() => {}); });
  }

  // Gate the first HTTP listen call. app.js can finish loading routes and
  // workers, but public traffic cannot be accepted until the active fence is
  // successfully acquired.
  originalListen = http.Server.prototype.listen;
  http.Server.prototype.listen = function fencedListen(...args) {
    if (claimed) return originalListen.apply(this, args);
    if (claimInFlight) return this;

    claimFence()
      .then(() => {
        if (!claimed) return fatal("fence acquisition completed without ownership");
        http.Server.prototype.listen = originalListen;
        originalListen.apply(this, args);
      })
      .catch(err => fatal("unable to acquire active runtime fence", err));

    return this;
  };

  module.exports = { enabled: true, ownerId, takeover };
}
