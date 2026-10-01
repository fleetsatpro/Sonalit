/*
 * Sonalit runtime fencing.
 *
 * Exactly one production runtime may own the active role at a time. Railway
 * remains the primary; the Docker standby starts with SONALIT_STANDBY=true and
 * therefore never claims the fence. Railway replacements are handed over by
 * deployment identity; the older runtime self-quiesces as soon as it loses ownership.
 *
 * The claim runs synchronously in a child Node process BEFORE app.js is loaded.
 * That means active cron registration, workers, routes and HTTP listeners cannot
 * start until the process owns the authoritative PostgreSQL runtime lease. On
 * Railway, a newer deployment may take the lease from the older deployment, and
 * the older process immediately disables scheduled work and operational HTTP.
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
const railwayDeploymentId = process.env.RAILWAY_DEPLOYMENT_ID || null;
const isRailwayPrimary = isProduction && Boolean(railwayDeploymentId && process.env.RAILWAY_SERVICE_ID);
const FENCE_STALE_SECONDS = Math.max(30, Number(process.env.SONALIT_FENCE_STALE_SECONDS || 60));
const FENCE_HEARTBEAT_MS = Math.max(1_000, Number(process.env.SONALIT_FENCE_HEARTBEAT_MS || 5_000));
let fenceActive = !isProduction || isStandby;
let fenceClient = null;
const activeCronTasks = [];
let cronGateInstalled = false;

function shouldTakeOver({ takeoverRequested, incomingDeploymentId, currentDeploymentId }) {
  if (takeoverRequested) return true;
  return Boolean(incomingDeploymentId && currentDeploymentId) && currentDeploymentId !== incomingDeploymentId;
}

function classifyFenceStart({
  production,
  standby,
  takeoverRequested,
  incomingDeploymentId,
  currentOwner,
  currentDeploymentId,
  stale,
}) {
  if (!production || standby) return 'bypass';
  if (!currentOwner || stale || takeoverRequested) return 'active';
  if (incomingDeploymentId && currentDeploymentId && currentDeploymentId !== incomingDeploymentId) return 'active';
  return 'refuse';
}

function installCronGate() {
  if (cronGateInstalled || !isProduction || isStandby || isClaimChild) return;
  const Module = require('module');
  const originalLoad = Module._load;
  Module._load = function sonalitFenceAwareLoad(request, parent, isMain) {
    const loaded = originalLoad.call(this, request, parent, isMain);
    if (request !== 'node-cron' || loaded.__sonalitFenceWrapped) return loaded;
    const wrapped = Object.assign({}, loaded);
    wrapped.schedule = function guardedSchedule(expression, callback, options) {
      const task = loaded.schedule(expression, (...args) => {
        if (!fenceActive) return undefined;
        return callback(...args);
      }, options);
      activeCronTasks.push(task);
      return task;
    };
    Object.defineProperty(wrapped, '__sonalitFenceWrapped', { value: true });
    return wrapped;
  };
  cronGateInstalled = true;
}

function stopActiveCronTasks() {
  while (activeCronTasks.length) {
    const task = activeCronTasks.pop();
    try { task.stop?.(); } catch (_) {}
    try { task.destroy?.(); } catch (_) {}
  }
}

async function deactivateFence() {
  if (global.__sonalitFenceShutdownStarted) return;
  global.__sonalitFenceShutdownStarted = true;
  fenceActive = false;
  stopActiveCronTasks();

  const workers = Array.isArray(global._workers) ? [...global._workers] : [];
  global._workers = [];
  await Promise.race([
    Promise.all(
      workers.map((worker) => Promise.resolve(worker?.close?.()).catch(() => {}))
    ),
    new Promise((resolve) => setTimeout(resolve, 2_000)),
  ]);

  try {
    if (global._server?.close) global._server.close();
  } catch (_) {}
}

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
    // The fence is authoritative in public, matching the migration/schema gate.
    await client.query("SET search_path TO public");
    await client.query(`
      CREATE TABLE IF NOT EXISTS sonalit_runtime_fence (
        id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
        owner_id TEXT,
        acquired_at TIMESTAMPTZ,
        heartbeat_at TIMESTAMPTZ,
        deployment_id TEXT
      )
    `);
    await client.query(`
      ALTER TABLE sonalit_runtime_fence
      ADD COLUMN IF NOT EXISTS deployment_id TEXT
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
               deployment_id,
               EXTRACT(EPOCH FROM (NOW() - heartbeat_at)) AS age_seconds
        FROM sonalit_runtime_fence
        WHERE id = 1
        FOR UPDATE
      `);
      const current = rows[0] || {};
      const stale = !current.owner_id || current.age_seconds == null || Number(current.age_seconds) >= FENCE_STALE_SECONDS;
      const startMode = classifyFenceStart({
        production: isProduction,
        standby: isStandby,
        takeoverRequested: takeover,
        incomingDeploymentId: railwayDeploymentId,
        currentOwner: current.owner_id,
        currentDeploymentId: current.deployment_id || null,
        stale,
      });
      const controlledRailwayReplacement =
        isRailwayPrimary &&
        !stale &&
        current.owner_id &&
        current.owner_id !== ownerId &&
        shouldTakeOver({
          takeoverRequested: false,
          incomingDeploymentId: railwayDeploymentId,
          currentDeploymentId: current.deployment_id || null,
        });

      if (startMode === 'refuse') {
        console.error(`SONALIT runtime fence: active runtime ${current.owner_id} already owns the lease; refusing split-brain startup`);
        process.exitCode = 78;
        return;
      }

      if (current.owner_id && current.owner_id !== ownerId && !stale && (takeover || controlledRailwayReplacement)) {
        console.info(
          controlledRailwayReplacement
            ? "SONALIT runtime fence: Railway replacement deployment " + railwayDeploymentId + " taking over from active owner " + current.owner_id
            : "SONALIT runtime fence: takeover requested; replacing active owner " + current.owner_id
        );
      }

      await client.query(`
        UPDATE sonalit_runtime_fence
        SET owner_id = $1,
            acquired_at = NOW(),
            heartbeat_at = NOW(),
            deployment_id = $2
        WHERE id = 1
      `, [ownerId, railwayDeploymentId]);
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
  module.exports = {
    enabled: false,
    standby: isStandby,
    shouldTakeOver,
    classifyFenceStart,
    isFenceActive: () => true,
  };
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

  fenceActive = true;
  installCronGate();

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 10_000,
    application_name: `sonalit-active-fence:${ownerId}`,
  });
  fenceClient = client;
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
    if (fenceActive) void deactivateFence().finally(() => process.exit(78));
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
            await deactivateFence();
            process.exit(78);
          }
        } catch (err) {
          console.error(`SONALIT runtime fence: heartbeat failed: ${err.message || String(err)}`);
          await deactivateFence();
          process.exit(78);
        }
      }, FENCE_HEARTBEAT_MS);
      heartbeatTimer.unref();
      process.once("SIGTERM", () => { stopFence().finally(() => {}); });
      process.once("SIGINT", () => { stopFence().finally(() => {}); });
    })
    .catch(err => {
      console.error(`SONALIT runtime fence: heartbeat connection failed: ${err.message || String(err)}`);
      void deactivateFence().finally(() => process.exit(78));
    });

  module.exports = {
    enabled: true,
    ownerId,
    takeover,
    staleSeconds: FENCE_STALE_SECONDS,
    deploymentId: railwayDeploymentId,
    isFenceActive: () => fenceActive,
  };
}
