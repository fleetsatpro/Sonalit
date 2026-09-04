import { defineConfig } from 'vitest/config';

// src/config.ts parses process.env at module load, so anything importing a
// module that touches config (db.ts, redis.ts, the AI plane) needs these
// present before the first import. They are placeholders: unit tests mock
// the DB and adapters, and integration tests override them with real
// testcontainer URLs.
export default defineConfig({
  test: {
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgres://test:test@127.0.0.1:5432/test',
      REDIS_URL: 'redis://127.0.0.1:6379',
    },
  },
});
