import { Redis } from 'ioredis';

import { config } from './config.js';

export const redis = new Redis(config.REDIS_URL, {
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
  lazyConnect: false,
});

redis.on('error', (_err: Error) => {
  // errors surfaced via server logger in index.ts
});
