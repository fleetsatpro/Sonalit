import { z } from 'zod';
const ConfigSchema = z.object({
  PORT: z.coerce.number().default(4007),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('production'),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string(),
  NATS_URL: z.string().default('nats://localhost:4222'),
  FCM_SERVER_KEY: z.string().optional(),
  POSTMARK_API_KEY: z.string().optional(),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
});
export const config = ConfigSchema.parse(process.env);
