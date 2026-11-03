import { z } from 'zod';

const ConfigSchema = z.object({
  PORT: z.coerce.number().default(4004),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('production'),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  NATS_URL: z.string().default('nats://localhost:4222'),
  R2_ENDPOINT: z.string().url(),
  R2_ACCESS_KEY_ID: z.string(),
  R2_SECRET_ACCESS_KEY: z.string(),
  R2_BUCKET_PHOTOS: z.string().default('sonalit-photos'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
  ENROLL_RATE_LIMIT_PER_HOUR: z.coerce.number().default(10),
  CFO_LOGIN_RATE_LIMIT_PER_15MIN: z.coerce.number().default(5),
  PLAY_INTEGRITY_MAX_AGE_SECONDS: z.coerce.number().default(21600),
});

export type Config = z.infer<typeof ConfigSchema>;
export const config = ConfigSchema.parse(process.env);
