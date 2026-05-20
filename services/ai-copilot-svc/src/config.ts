import { z } from 'zod';

const ConfigSchema = z.object({
  PORT: z.coerce.number().default(4010),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('production'),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string(),
  ANTHROPIC_API_KEY: z.string().min(1),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
  CIRCUIT_BREAKER_THRESHOLD: z.coerce.number().default(5),
});

export type Config = z.infer<typeof ConfigSchema>;
export const config = ConfigSchema.parse(process.env);
