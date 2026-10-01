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
});
