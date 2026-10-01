const { pool } = require('../config/database');

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
    } catch (_) {
      // PostgreSQL releases session advisory locks when the client disconnects.
    }
    client.release();
  }
}

module.exports = { withAdvisoryLock };
