import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/redis.js', () => ({
  redisCluster: {
    pipeline: vi.fn(),
  },
}));

vi.mock('../../src/config.js', () => ({
  config: {
    DEDUP_TTL_SECONDS: 3600,
    REDIS_CLUSTER_URL: 'redis://localhost:6379',
    PORT: 4005,
    NODE_ENV: 'test',
    NATS_URL: 'nats://localhost:4222',
    LOG_LEVEL: 'error',
    MAX_BATCH_SIZE: 50,
    BATCH_FLUSH_MS: 200,
    BATCH_MAX_ROWS: 1000,
  },
}));

import { redisCluster } from '../../src/redis.js';
import { dedupFixes } from '../../src/lib/dedup.js';

type MockPipeline = {
  set: ReturnType<typeof vi.fn>;
  exec: ReturnType<typeof vi.fn>;
};

function makePipeline(results: Array<[Error | null, string | null]>): MockPipeline {
  const pipeline: MockPipeline = {
    set: vi.fn().mockReturnThis(),
    exec: vi.fn().mockResolvedValue(results),
  };
  return pipeline;
}

describe('dedupFixes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('accepts all fixes on first occurrence', async () => {
    const fixes = [
      { seq_no: 1, lat: 1.0, lng: 2.0, timestamp: '2024-01-01T00:00:00Z' },
      { seq_no: 2, lat: 1.1, lng: 2.1, timestamp: '2024-01-01T00:01:00Z' },
    ];

    const pipeline = makePipeline([[null, 'OK'], [null, 'OK']]);
    vi.mocked(redisCluster.pipeline).mockReturnValue(pipeline as unknown as ReturnType<typeof redisCluster.pipeline>);

    const result = await dedupFixes('device-001', fixes);

    expect(result.accepted).toHaveLength(2);
    expect(result.duplicateCount).toBe(0);
    expect(pipeline.set).toHaveBeenCalledTimes(2);
    expect(pipeline.set).toHaveBeenNthCalledWith(1, 'dedup:device-001:1', '1', 'EX', 3600, 'NX');
    expect(pipeline.set).toHaveBeenNthCalledWith(2, 'dedup:device-001:2', '1', 'EX', 3600, 'NX');
  });

  it('rejects duplicate fixes (second occurrence)', async () => {
    const fixes = [
      { seq_no: 1, lat: 1.0, lng: 2.0, timestamp: '2024-01-01T00:00:00Z' },
    ];

    // NX returns null (key already exists) on duplicate
    const pipeline = makePipeline([[null, null]]);
    vi.mocked(redisCluster.pipeline).mockReturnValue(pipeline as unknown as ReturnType<typeof redisCluster.pipeline>);

    const result = await dedupFixes('device-001', fixes);

    expect(result.accepted).toHaveLength(0);
    expect(result.duplicateCount).toBe(1);
  });

  it('accepts mix of new and duplicate fixes', async () => {
    const fixes = [
      { seq_no: 1, lat: 1.0, lng: 2.0, timestamp: '2024-01-01T00:00:00Z' },
      { seq_no: 2, lat: 1.1, lng: 2.1, timestamp: '2024-01-01T00:01:00Z' },
      { seq_no: 3, lat: 1.2, lng: 2.2, timestamp: '2024-01-01T00:02:00Z' },
    ];

    // fix 1 is new (OK), fix 2 is duplicate (null), fix 3 is new (OK)
    const pipeline = makePipeline([[null, 'OK'], [null, null], [null, 'OK']]);
    vi.mocked(redisCluster.pipeline).mockReturnValue(pipeline as unknown as ReturnType<typeof redisCluster.pipeline>);

    const result = await dedupFixes('device-001', fixes);

    expect(result.accepted).toHaveLength(2);
    expect(result.accepted[0]?.seq_no).toBe(1);
    expect(result.accepted[1]?.seq_no).toBe(3);
    expect(result.duplicateCount).toBe(1);
  });

  it('returns empty result for empty input', async () => {
    const result = await dedupFixes('device-001', []);

    expect(result.accepted).toHaveLength(0);
    expect(result.duplicateCount).toBe(0);
    expect(redisCluster.pipeline).not.toHaveBeenCalled();
  });

  it('after TTL expiry the same seq_no is accepted again', async () => {
    const fixes = [{ seq_no: 42, lat: 1.0, lng: 2.0, timestamp: '2024-01-01T00:00:00Z' }];

    // Simulate TTL expired: Redis NX succeeds again
    const pipeline = makePipeline([[null, 'OK']]);
    vi.mocked(redisCluster.pipeline).mockReturnValue(pipeline as unknown as ReturnType<typeof redisCluster.pipeline>);

    const result = await dedupFixes('device-001', fixes);

    expect(result.accepted).toHaveLength(1);
    expect(result.duplicateCount).toBe(0);
    expect(pipeline.set).toHaveBeenCalledWith('dedup:device-001:42', '1', 'EX', 3600, 'NX');
  });
});
