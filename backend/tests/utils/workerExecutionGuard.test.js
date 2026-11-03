'use strict';

jest.mock('../../src/config/database', () => ({
  pool: {
    connect: jest.fn()
  }
}));

describe('worker advisory execution guard', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  test('skips the callback when another worker owns the lock', async () => {
    const client = {
      query: jest.fn().mockResolvedValueOnce({ rows: [{ acquired: false }] }),
      release: jest.fn()
    };
    const { pool } = require('../../src/config/database');
    pool.connect.mockResolvedValueOnce(client);
    const { withAdvisoryLock } = require('../../src/utils/workerExecutionGuard');
    const callback = jest.fn();

    const result = await withAdvisoryLock('sonalit:test-lock', callback);

    expect(result.locked).toBe(false);
    expect(callback).not.toHaveBeenCalled();
    expect(client.query).toHaveBeenCalledTimes(1);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  test('runs the callback and releases the session lock', async () => {
    const client = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [{ acquired: true }] })
        .mockResolvedValueOnce({ rows: [{ pg_advisory_unlock: true }] }),
      release: jest.fn()
    };
    const { pool } = require('../../src/config/database');
    pool.connect.mockResolvedValueOnce(client);
    const { withAdvisoryLock } = require('../../src/utils/workerExecutionGuard');
    const callback = jest.fn().mockResolvedValue({ completed: true });

    const result = await withAdvisoryLock('sonalit:test-lock', callback);

    expect(result).toEqual({ locked: true, value: { completed: true } });
    expect(callback).toHaveBeenCalledTimes(1);
    expect(client.query).toHaveBeenNthCalledWith(
      1,
      "SELECT pg_try_advisory_lock(hashtext($1)) AS acquired",
      ['sonalit:test-lock']
    );
    expect(client.query).toHaveBeenNthCalledWith(
      2,
      "SELECT pg_advisory_unlock(hashtext($1))",
      ['sonalit:test-lock']
    );
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  test('still releases the connection when the callback fails', async () => {
    const client = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [{ acquired: true }] })
        .mockResolvedValueOnce({ rows: [{ pg_advisory_unlock: true }] }),
      release: jest.fn()
    };
    const { pool } = require('../../src/config/database');
    pool.connect.mockResolvedValueOnce(client);
    const { withAdvisoryLock } = require('../../src/utils/workerExecutionGuard');
    await expect(
      withAdvisoryLock('sonalit:test-lock', async () => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');
    expect(client.query).toHaveBeenCalledTimes(2);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  test('holds leadership until the owner stops and then releases the session lock', async () => {
    const { EventEmitter } = require('events');
    const client = Object.assign(new EventEmitter(), {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [{ acquired: true }] })
        .mockResolvedValueOnce({ rows: [{ pg_advisory_unlock: true }] }),
      release: jest.fn()
    });
    const { pool } = require('../../src/config/database');
    pool.connect.mockResolvedValueOnce(client);
    const { startAdvisoryLeader } = require('../../src/utils/workerExecutionGuard');
    const onAcquire = jest.fn().mockResolvedValue(undefined);
    const logger = { info: jest.fn(), warn: jest.fn() };

    const leader = await startAdvisoryLeader('sonalit:leader-test', {
      retryMs: 1,
      onAcquire,
      logger
    });

    await new Promise(resolve => setTimeout(resolve, 5));
    expect(onAcquire).toHaveBeenCalledTimes(1);
    expect(client.query).toHaveBeenCalledWith(
      "SELECT pg_try_advisory_lock(hashtext($1)) AS acquired",
      ['sonalit:leader-test']
    );

    await leader.stop();
    await leader.promise;
    expect(client.query).toHaveBeenCalledWith(
      "SELECT pg_advisory_unlock(hashtext($1))",
      ['sonalit:leader-test']
    );
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  test('re-elects after the leadership connection emits an error', async () => {
    const { EventEmitter } = require('events');
    const first = Object.assign(new EventEmitter(), {
      query: jest.fn().mockResolvedValueOnce({ rows: [{ acquired: true }] }).mockResolvedValueOnce({ rows: [{ pg_advisory_unlock: true }] }),
      release: jest.fn()
    });
    const second = Object.assign(new EventEmitter(), {
      query: jest.fn().mockResolvedValueOnce({ rows: [{ acquired: true }] }).mockResolvedValueOnce({ rows: [{ pg_advisory_unlock: true }] }),
      release: jest.fn()
    });
    const { pool } = require('../../src/config/database');
    pool.connect.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const { startAdvisoryLeader } = require('../../src/utils/workerExecutionGuard');
    const acquisitions = [];
    const leader = await startAdvisoryLeader('sonalit:leader-re-election', {
      retryMs: 1,
      onAcquire: async () => { acquisitions.push(acquisitions.length + 1); },
      onLose: jest.fn(),
      logger: { info: jest.fn(), warn: jest.fn() }
    });

    await new Promise(resolve => setTimeout(resolve, 5));
    expect(acquisitions).toHaveLength(1);
    first.emit('error', new Error('database connection lost'));

    for (let i = 0; i < 100 && acquisitions.length < 2; i += 1) {
      await new Promise(resolve => setTimeout(resolve, 2));
    }
    expect(acquisitions).toHaveLength(2);
    expect(first.release).toHaveBeenCalledTimes(1);

    await leader.stop();
    await leader.promise;
    expect(second.release).toHaveBeenCalledTimes(1);
  });

  test('releases a leadership lock when the acquisition callback throws', async () => {
    const { EventEmitter } = require('events');
    const client = Object.assign(new EventEmitter(), {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [{ acquired: true }] })
        .mockResolvedValueOnce({ rows: [{ pg_advisory_unlock: true }] }),
      release: jest.fn()
    });
    const { pool } = require('../../src/config/database');
    pool.connect.mockResolvedValueOnce(client);
    const { startAdvisoryLeader } = require('../../src/utils/workerExecutionGuard');

    const leader = await startAdvisoryLeader('sonalit:leader-error', {
      retryMs: 1,
      onAcquire: async () => { throw new Error('startup failure'); },
      logger: { info: jest.fn(), warn: jest.fn() }
    });

    for (let i = 0; i < 20 && !client.release.mock.calls.length; i += 1) {
      await new Promise(resolve => setTimeout(resolve, 2));
    }
    await leader.stop();
    await leader.promise;
    expect(client.query).toHaveBeenCalledWith(
      "SELECT pg_advisory_unlock(hashtext($1))",
      ['sonalit:leader-error']
    );
    expect(client.release).toHaveBeenCalledTimes(1);
  });

});
