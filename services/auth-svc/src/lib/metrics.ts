import { register, collectDefaultMetrics, Counter } from 'prom-client';

collectDefaultMetrics({ register });

export const loginCounter = new Counter({
  name: 'auth_login_total',
  help: 'Total login attempts',
  labelNames: ['result'] as const,
  registers: [register],
});

export const registerCounter = new Counter({
  name: 'auth_register_total',
  help: 'Total registration attempts',
  registers: [register],
});

export const tokenRefreshCounter = new Counter({
  name: 'auth_token_refresh_total',
  help: 'Total token refresh attempts',
  labelNames: ['result'] as const,
  registers: [register],
});

export { register };
