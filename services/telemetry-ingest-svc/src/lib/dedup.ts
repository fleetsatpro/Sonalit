import { redisCluster } from '../redis.js';
import { config } from '../config.js';

export interface GpsFix {
  seq_no: bigint | number;
  [key: string]: unknown;
}

export interface DedupResult<T extends GpsFix> {
  accepted: T[];
  duplicateCount: number;
}

export async function dedupFixes<T extends GpsFix>(
  deviceId: string,
  fixes: T[],
): Promise<DedupResult<T>> {
  if (fixes.length === 0) {
    return { accepted: [], duplicateCount: 0 };
  }

  const keys = fixes.map((f) => `dedup:${deviceId}:${String(f.seq_no)}`);
  const pipeline = redisCluster.pipeline();

  for (const key of keys) {
    pipeline.set(key, '1', 'EX', config.DEDUP_TTL_SECONDS, 'NX');
  }

  const results = await pipeline.exec();

  const accepted: T[] = [];
  let duplicateCount = 0;

  for (let i = 0; i < fixes.length; i++) {
    const result = results?.[i];
    if (result?.[0] === null && result?.[1] === 'OK') {
      accepted.push(fixes[i]);
    } else {
      duplicateCount++;
    }
  }

  return { accepted, duplicateCount };
}
