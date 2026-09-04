import { z } from 'zod';

const ConfigSchema = z.object({
  PORT: z.coerce.number().default(4010),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('production'),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string(),
  // Optional by design: which credentials are needed is a property of the
  // rows in `ai_models`, not of this service. A deployment running only
  // self-hosted open-weight endpoints has no Anthropic key and must still
  // start. Adapters fail per-model, at call time, naming the missing var.
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
  CIRCUIT_BREAKER_THRESHOLD: z.coerce.number().default(5),
});

export type Config = z.infer<typeof ConfigSchema>;
export const config = ConfigSchema.parse(process.env);
