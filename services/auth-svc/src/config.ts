import { z } from 'zod';

const ConfigSchema = z.object({
  PORT: z.coerce.number().default(4001),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('production'),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string(),
  NATS_URL: z.string().default('nats://localhost:4222'),
  VAULT_ADDR: z.string().url().optional(),
  VAULT_TOKEN: z.string().optional(),
  VAULT_TRANSIT_KEY: z.string().default('sonalit-jwt'),
  JWT_ISSUER: z.string().default('https://auth.sonalit.io'),
  JWT_AUDIENCE: z.string().default('sonalit-v4'),
  JWT_ACCESS_TTL_S: z.coerce.number().default(300),
  JWT_REFRESH_TTL_S: z.coerce.number().default(604800),
  WEBAUTHN_RP_ID: z.string().default('sonalit.io'),
  WEBAUTHN_RP_NAME: z.string().default('Sonalit'),
  WEBAUTHN_ORIGIN: z.string().default('https://app.sonalit.io'),
  HIBP_API_KEY: z.string().optional(),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
});

export type Config = z.infer<typeof ConfigSchema>;
export const config = ConfigSchema.parse(process.env);
