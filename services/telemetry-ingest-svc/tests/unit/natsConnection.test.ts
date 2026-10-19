import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ connect: vi.fn() }));

vi.mock('nats', () => ({
  connect: mocks.connect,
  RetentionPolicy: { Limits: 'limits' },
  StorageType: { File: 'file' },
}));
vi.mock('../../src/config.js', () => ({ config: { NATS_URL: 'nats://localhost:4222' } }));

describe('NATS connection management', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  function makeConnection() {
    const jetStream = { publish: vi.fn() };
    const streamManager = {
      streams: {
        list: vi.fn().mockReturnValue({ next: vi.fn().mockResolvedValue([]) }),
        add: vi.fn().mockResolvedValue(undefined),
      },
    };
    const connection = {
      isClosed: vi.fn(() => false),
      jetstreamManager: vi.fn().mockResolvedValue(streamManager),
      jetstream: vi.fn().mockReturnValue(jetStream),
      close: vi.fn().mockResolvedValue(undefined),
      drain: vi.fn().mockResolvedValue(undefined),
    };
    return { connection, jetStream, streamManager };
  }

  it('stays not-ready after an initial broker outage and can reconnect cleanly', async () => {
    const api = await import('../../src/nats.js');
    const readyConnection = makeConnection();
    mocks.connect
      .mockRejectedValueOnce(new Error('broker unavailable'))
      .mockResolvedValueOnce(readyConnection.connection);

    await expect(api.connectNats()).rejects.toThrow('broker unavailable');
    await expect(api.isNatsReady()).resolves.toBe(false);
    expect(() => api.getJs()).toThrow('NATS not connected');

    await api.connectNats();
    await expect(api.isNatsReady()).resolves.toBe(true);
    expect(api.getJs()).toBe(readyConnection.jetStream);
    expect(readyConnection.streamManager.streams.add).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'TELEMETRY', subjects: ['telemetry.gps.>'] }),
    );
    expect(mocks.connect).toHaveBeenCalledTimes(2);
  });

  it('reuses a healthy connection instead of creating a second connection per retry tick', async () => {
    const api = await import('../../src/nats.js');
    const readyConnection = makeConnection();
    mocks.connect.mockResolvedValue(readyConnection.connection);

    await api.connectNats();
    await api.connectNats();

    expect(mocks.connect).toHaveBeenCalledTimes(1);
    expect(readyConnection.connection.jetstreamManager).toHaveBeenCalledTimes(1);
  });
});
