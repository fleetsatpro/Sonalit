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
  // Base URL of a self-hosted OpenAI-compatible inference server (vLLM,
  // Ollama, TGI). Read by the migration when seeding embedding models; the
  // registry is the runtime source of truth, so changing a model's endpoint
  // later is an UPDATE, not a redeploy.
  EMBEDDING_ENDPOINT: z.string().url().optional(),
  NATS_URL: z.string().default('nats://localhost:4222'),
  // Watchtower consumes the platform's event buses. Off by default so that
  // enabling event ingestion is a deliberate deployment decision rather
  // than a side effect of starting the service.
  WATCHTOWER_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});

export type Config = z.infer<typeof ConfigSchema>;
export const config = ConfigSchema.parse(process.env);
