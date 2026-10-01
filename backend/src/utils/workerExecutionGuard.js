const { pool } = require('../config/database');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function tryAcquireAdvisoryLeadership(key) {
  const client = await pool.connect();
  try {
    const result = await client.query(
      "SELECT pg_try_advisory_lock(hashtext($1)) AS acquired",
      [key]
    );
    if (!result.rows[0]?.acquired) {
      client.release();
      return null;
    }
    let released = false;
    return {
      client,
      key,
      async release() {
        if (released) return;
        released = true;
        try {
          await client.query(
            "SELECT pg_advisory_unlock(hashtext($1))",
            [key]
          );
        } catch (_) {
          // PostgreSQL releases the session lock automatically on disconnect.
        }
        client.release();
      }
    };
  } catch (error) {
    client.release();
    throw error;
  }
}

async function startAdvisoryLeader(key, {
  retryMs = 15000,
  onAcquire,
  onLose,
  logger
} = {}) {
  let stopped = false;
  let current = null;
  let stoppingPromise = null;

  async function stop() {
    if (stoppingPromise) return stoppingPromise;
    stoppingPromise = (async () => {
      stopped = true;
      await current?.release?.();
    })();
    return stoppingPromise;
  }

  async function run() {
    while (!stopped) {
      try {
        const leadership = await tryAcquireAdvisoryLeadership(key);
        if (!leadership) {
          logger?.info?.(`Advisory leader busy: key=${key}; retrying in ${retryMs}ms`);
          await sleep(retryMs);
          continue;
        }

        current = leadership;
        logger?.info?.(`Advisory leader acquired: key=${key}`);
        let lostResolve;
        const lost = new Promise((resolve) => { lostResolve = resolve; });
        const onError = (error) => lostResolve(error instanceof Error ? error : new Error(String(error)));

        leadership.client.once('error', onError);
        try {
          await onAcquire?.(leadership);
          await lost;
        } finally {
          leadership.client.removeListener?.('error', onError);
        }

        if (!stopped) {
          logger?.warn?.(`Advisory leader lost: key=${key}; re-electing`);
          await onLose?.();
        }
        await leadership.release();
        current = null;
      } catch (error) {
        current = null;
        logger?.warn?.(`Advisory leader loop failed: key=${key}; ${error.message}`);
        if (!stopped) await sleep(retryMs);
      }
    }
  }

  const promise = run();
  return { stop, promise };
}

async function withAdvisoryLock(key, fn) {
  const client = await pool.connect();
  let locked = false;
  try {
    const result = await client.query(
      "SELECT pg_try_advisory_lock(hashtext($1)) AS acquired",
      [key]
    );
    locked = Boolean(result.rows[0]?.acquired);
    if (!locked) return { locked: false, value: undefined };
    return { locked: true, value: await fn() };
  } finally {
    try {
      if (locked) {
        await client.query(
          "SELECT pg_advisory_unlock(hashtext($1))",
          [key]
        );
      }
    } catch (_) {}
    client.release();
  }
}

module.exports = {
  tryAcquireAdvisoryLeadership,
  startAdvisoryLeader,
  withAdvisoryLock
};
