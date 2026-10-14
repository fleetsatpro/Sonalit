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

// A zero-row heartbeat update is the expected signal that a replacement runtime
// acquired the lease. It is not equivalent to a database/heartbeat failure.
function classifyFenceHeartbeat(rowCount) {
  return rowCount === 1 ? 'owned' : 'superseded';
}

function shouldRefuseRetiredDeployment({ candidateIsRetired, takeoverRequested, currentLeaseStale }) {
  return Boolean(candidateIsRetired) && !takeoverRequested && !currentLeaseStale;
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

async function installFenceDeploymentGuard(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS public.sonalit_runtime_fence_authority (
      id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      deployment_id TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      stale_after_seconds INTEGER NOT NULL DEFAULT 60
    )
  `);
  await client.query(`
    ALTER TABLE public.sonalit_runtime_fence_authority
      ADD COLUMN IF NOT EXISTS stale_after_seconds INTEGER NOT NULL DEFAULT 60
  `);
  await client.query(`
    INSERT INTO public.sonalit_runtime_fence_authority (id, deployment_id)
    VALUES (1, NULL)
    ON CONFLICT (id) DO NOTHING
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS public.sonalit_runtime_fence_retired_deployments (
      deployment_id TEXT PRIMARY KEY,
      retired_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      superseded_by TEXT
    )
  `);
  await client.query(`
    CREATE OR REPLACE FUNCTION public.sonalit_runtime_fence_authority_guard()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $sonalit$
    DECLARE
      authorized_deployment_id TEXT;
      lease_ttl_seconds INTEGER;
      active_heartbeat_at TIMESTAMPTZ;
    BEGIN
      SELECT deployment_id, stale_after_seconds
        INTO authorized_deployment_id, lease_ttl_seconds
        FROM public.sonalit_runtime_fence_authority
       WHERE id = 1;

      -- A retired deployment cannot displace a live owner. If the current lease
      -- is genuinely stale, permit failover and atomically revive that identity.
      IF NEW.deployment_id IS NOT NULL AND EXISTS (
        SELECT 1
          FROM public.sonalit_runtime_fence_retired_deployments
         WHERE deployment_id = NEW.deployment_id
      ) THEN
        SELECT heartbeat_at
          INTO active_heartbeat_at
          FROM public.sonalit_runtime_fence
         WHERE id = 1;

        IF active_heartbeat_at IS NOT NULL
           AND active_heartbeat_at > NOW() - make_interval(secs => GREATEST(30, COALESCE(lease_ttl_seconds, 60))) THEN
          RAISE EXCEPTION
            'SONALIT runtime fence rejected retired deployment % while the current lease is live',
            NEW.deployment_id
            USING ERRCODE = '55000';
        END IF;

        DELETE FROM public.sonalit_runtime_fence_retired_deployments
         WHERE deployment_id = NEW.deployment_id;
        UPDATE public.sonalit_runtime_fence_authority
           SET deployment_id = NEW.deployment_id,
               updated_at = NOW()
         WHERE id = 1;
        authorized_deployment_id := NEW.deployment_id;
      END IF;

      IF NEW.deployment_id IS NOT NULL
         AND authorized_deployment_id IS NOT NULL
         AND NEW.deployment_id IS DISTINCT FROM authorized_deployment_id THEN
        RAISE EXCEPTION
          'SONALIT runtime fence rejected superseded deployment %; authority belongs to %',
          NEW.deployment_id, authorized_deployment_id
          USING ERRCODE = '55000';
      END IF;

      RETURN NEW;
    END;
    $sonalit$
  `);

  const { rowCount } = await client.query(`
    SELECT 1
      FROM pg_trigger
     WHERE tgname = 'sonalit_runtime_fence_authority_guard'
       AND tgrelid = 'public.sonalit_runtime_fence'::regclass
       AND NOT tgisinternal
  `);
  if (rowCount === 0) {
    await client.query(`
      CREATE TRIGGER sonalit_runtime_fence_authority_guard
      BEFORE UPDATE ON public.sonalit_runtime_fence
      FOR EACH ROW
      EXECUTE FUNCTION public.sonalit_runtime_fence_authority_guard()
    `);
  }

  await client.query(`
    CREATE OR REPLACE FUNCTION public.sonalit_runtime_fence_authority_write_guard()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $authority$
    DECLARE
      lease_ttl_seconds INTEGER;
      active_heartbeat_at TIMESTAMPTZ;
    BEGIN
      IF NEW.deployment_id IS NOT NULL AND EXISTS (
        SELECT 1
          FROM public.sonalit_runtime_fence_retired_deployments
         WHERE deployment_id = NEW.deployment_id
      ) THEN
        SELECT stale_after_seconds
          INTO lease_ttl_seconds
          FROM public.sonalit_runtime_fence_authority
         WHERE id = 1;
        SELECT heartbeat_at
          INTO active_heartbeat_at
          FROM public.sonalit_runtime_fence
         WHERE id = 1;

        IF active_heartbeat_at IS NOT NULL
           AND active_heartbeat_at > NOW() - make_interval(secs => GREATEST(30, COALESCE(lease_ttl_seconds, 60))) THEN
          RAISE EXCEPTION
            'SONALIT runtime fence refused re-authorizing retired deployment % while the current lease is live',
            NEW.deployment_id
            USING ERRCODE = '55000';
        END IF;

        DELETE FROM public.sonalit_runtime_fence_retired_deployments
         WHERE deployment_id = NEW.deployment_id;
      END IF;
      RETURN NEW;
    END;
    $authority$
  `);

  const authorityTrigger = await client.query(`
    SELECT 1
      FROM pg_trigger
     WHERE tgname = 'sonalit_runtime_fence_authority_write_guard'
       AND tgrelid = 'public.sonalit_runtime_fence_authority'::regclass
       AND NOT tgisinternal
  `);
  if (authorityTrigger.rowCount === 0) {
    await client.query(`
      CREATE TRIGGER sonalit_runtime_fence_authority_write_guard
      BEFORE INSERT OR UPDATE ON public.sonalit_runtime_fence_authority
      FOR EACH ROW
      EXECUTE FUNCTION public.sonalit_runtime_fence_authority_write_guard()
    `);
  }
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
      // Install the DB guard while holding the same advisory lock used by lease
      // claims. This blocks a legacy container from reclaiming authority after a
      // newer deployment starts, even before Railway finishes stopping old replicas.
      await installFenceDeploymentGuard(client);

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
      if (railwayDeploymentId) {
        const retiredCandidate = await client.query(`
          SELECT 1
            FROM public.sonalit_runtime_fence_retired_deployments
           WHERE deployment_id = $1
        `, [railwayDeploymentId]);
        if (shouldRefuseRetiredDeployment({
          candidateIsRetired: retiredCandidate.rowCount > 0,
          takeoverRequested: takeover,
          currentLeaseStale: stale,
        })) {
          console.error(`SONALIT runtime fence: deployment ${railwayDeploymentId} was previously superseded while the current lease is live; refusing automatic rollback takeover`);
          process.exitCode = 78;
          return;
        }
      }
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

      await client.query("BEGIN");
      try {
        if (railwayDeploymentId && (takeover || stale)) {
          await client.query(`
            DELETE FROM public.sonalit_runtime_fence_retired_deployments
             WHERE deployment_id = $1
          `, [railwayDeploymentId]);
        }
        // Publish the accepted deployment identity before changing the lease,
        // atomically. A legacy process can then neither heartbeat nor take over
        // the fence after this commit.
        if (railwayDeploymentId) {
          if (current.deployment_id && current.deployment_id !== railwayDeploymentId) {
            await client.query(`
              INSERT INTO public.sonalit_runtime_fence_retired_deployments (deployment_id, superseded_by)
              VALUES ($1, $2)
              ON CONFLICT (deployment_id) DO NOTHING
            `, [current.deployment_id, railwayDeploymentId]);
          }
          await client.query(`
            INSERT INTO public.sonalit_runtime_fence_authority (id, deployment_id, updated_at, stale_after_seconds)
            VALUES (1, $1, NOW(), $2)
            ON CONFLICT (id) DO UPDATE
              SET deployment_id = EXCLUDED.deployment_id,
                  updated_at = NOW(),
                  stale_after_seconds = EXCLUDED.stale_after_seconds
          `, [railwayDeploymentId, FENCE_STALE_SECONDS]);
        }
        await client.query(`
          UPDATE sonalit_runtime_fence
          SET owner_id = $1,
              acquired_at = NOW(),
              heartbeat_at = NOW(),
              deployment_id = $2
          WHERE id = 1
        `, [ownerId, railwayDeploymentId]);
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        throw err;
      }
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
    classifyFenceHeartbeat,
    shouldRefuseRetiredDeployment,
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
          if (classifyFenceHeartbeat(rowCount) === 'superseded') {
            console.warn("SONALIT runtime fence: lease transferred or removed; gracefully retiring superseded runtime");
            await deactivateFence();
            // Stop the heartbeat and close this owner's client. stopFence only
            // deletes a lease still owned by this process, so it cannot remove
            // the replacement runtime's record.
            await stopFence();
            process.exit(0);
            return;
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
    classifyFenceHeartbeat,
    shouldRefuseRetiredDeployment,
  };
}
