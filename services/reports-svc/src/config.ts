import { z } from 'zod';
const ConfigSchema = z.object({
  PORT: z.coerce.number().default(4009),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('production'),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string(),
  NATS_URL: z.string().default('nats://localhost:4222'),
  JWT_ISSUER: z.string().default('https://auth.sonalit.io'),
  JWT_AUDIENCE: z.string().default('sonalit-v4'),
  AUTH_JWKS_URI: z.string().url().optional(),
  AUTH_PUBLIC_KEY_PEM: z.string().optional(),
  BROWSERLESS_URL: z.string().url().optional(),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
});
export const config = ConfigSchema.parse(process.env);
