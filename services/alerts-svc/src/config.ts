import { z } from 'zod';

const ConfigSchema = z.object({
  PORT: z.coerce.number().default(4003),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('production'),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string(),
  NATS_URL: z.string().default('nats://localhost:4222'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
});

export type Config = z.infer<typeof ConfigSchema>;
export const config = ConfigSchema.parse(process.env);
