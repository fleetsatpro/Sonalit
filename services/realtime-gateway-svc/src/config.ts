import { z } from 'zod';

const ConfigSchema = z.object({
  PORT: z.coerce.number().default(4010),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('production'),
  NATS_URL: z.string().default('nats://localhost:4222'),
  CENTRIFUGO_API_URL: z.string().default('http://centrifugo:8000'),
  CENTRIFUGO_API_KEY: z.string(),
  JWT_SECRET: z.string().min(32),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
});

export type Config = z.infer<typeof ConfigSchema>;
export const config = ConfigSchema.parse(process.env);
