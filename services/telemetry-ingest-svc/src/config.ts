import { z } from 'zod';

const ConfigSchema = z.object({
  PORT: z.coerce.number().default(4005),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('production'),
  REDIS_CLUSTER_URL: z.string().default('redis://localhost:6379'),
  NATS_URL: z.string().default('nats://localhost:4222'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
  DEDUP_TTL_SECONDS: z.coerce.number().default(3600),
  MAX_BATCH_SIZE: z.coerce.number().default(50),
  BATCH_FLUSH_MS: z.coerce.number().default(200),
  BATCH_MAX_ROWS: z.coerce.number().default(1000),
});

export type Config = z.infer<typeof ConfigSchema>;
export const config = ConfigSchema.parse(process.env);
