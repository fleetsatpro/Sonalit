import { Cluster } from 'ioredis';
import { config } from './config.js';

const clusterNodes = config.REDIS_CLUSTER_URL.split(',').map((u) => {
  const url = new URL(u.startsWith('redis://') ? u : `redis://${u}`);
  return { host: url.hostname, port: Number(url.port) || 6379 };
});

export const redisCluster = new Cluster(clusterNodes, {
  enableReadyCheck: true,
  maxRedirections: 16,
  retryDelayOnFailover: 100,
  retryDelayOnClusterDown: 100,
  clusterRetryStrategy: (times: number) => Math.min(100 * times, 3000),
  slotsRefreshTimeout: 2000,
  slotsRefreshInterval: 5000,
  redisOptions: {
    connectTimeout: 5000,
    maxRetriesPerRequest: 3,
  },
});

redisCluster.on('error', (_err: Error) => {
  // forwarded to pino logger via server.ts registration
});

export async function isRedisReady(): Promise<boolean> {
  try {
    const result = await redisCluster.ping();
    return result === 'PONG';
  } catch {
    return false;
  }
}
