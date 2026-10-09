'use strict';

describe('shared GDELT response and cooldown contract', () => {
  let fetchGdeltJson;
  let resetState;
  let fetchMock;

  beforeEach(() => {
    jest.resetModules();
    jest.useRealTimers();
    fetchMock = jest.fn();
    jest.spyOn(global, 'fetch').mockImplementation(fetchMock);
    ({ fetchGdeltJson, _resetGdeltStateForTests: resetState } = require('../src/utils/gdeltClient'));
    resetState();
  });

  afterEach(() => {
    resetState?.();
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  const response = ({ status = 200, ok = true, contentType = 'application/json', body = '' } = {}) => ({
    status,
    ok,
    headers: {
      get: name => name.toLowerCase() === 'content-type'
        ? contentType
        : name.toLowerCase() === 'content-length' ? String(Buffer.byteLength(body)) : null,
    },
    text: jest.fn().mockResolvedValue(body),
    json: jest.fn(() => { throw new Error('GDELT must be parsed from the bounded response text'); }),
  });

  test('parses a valid response even when upstream uses a generic content type', async () => {
    const upstream = response({
      contentType: 'text/plain; charset=utf-8',
      body: JSON.stringify({ articles: [{ title: 'Road closure', url: 'https://news.example/item' }] }),
    });
    fetchMock.mockResolvedValue(upstream);

    await expect(fetchGdeltJson('https://api.gdeltproject.org/api/v2/doc/doc?format=json'))
      .resolves.toMatchObject({ articles: [{ title: 'Road closure', url: 'https://news.example/item' }] });

    expect(upstream.text).toHaveBeenCalledTimes(1);
    expect(upstream.json).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('classifies an HTTP-200 plain-text query rejection and never leaks its body', async () => {
    const upstream = response({
      contentType: 'text/html; charset=UTF-8',
      body: 'Your query has been rejected by GDELT because the query is not valid.',
    });
    fetchMock.mockResolvedValue(upstream);

    await expect(fetchGdeltJson('https://api.gdeltproject.org/api/v2/doc/doc'))
      .rejects.toMatchObject({
        message: 'GDELT returned a non-JSON response (HTTP 200, content-type text/html)',
        failureClass: 'upstream_protocol',
        upstreamStatus: 200,
      });

    await expect(fetchGdeltJson('https://api.gdeltproject.org/api/v2/doc/doc'))
      .rejects.toMatchObject({ failureClass: 'cooldown' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('classifies HTTP-200 throttle notices as rate limiting, not empty results', async () => {
    fetchMock.mockResolvedValue(response({
      contentType: 'text/plain',
      body: 'Rate limit reached. Please try again later.',
    }));

    await expect(fetchGdeltJson('https://api.gdeltproject.org/api/v2/doc/doc'))
      .rejects.toMatchObject({ message: 'GDELT rate limited; circuit opened', failureClass: 'rate_limited' });
    await expect(fetchGdeltJson('https://api.gdeltproject.org/api/v2/doc/doc'))
      .rejects.toMatchObject({ failureClass: 'cooldown' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('HTTP 429 opens the shared cooldown and suppresses the next upstream call', async () => {
    fetchMock.mockResolvedValue(response({ status: 429, ok: false, body: '' }));

    await expect(fetchGdeltJson('https://api.gdeltproject.org/api/v2/doc/doc'))
      .rejects.toMatchObject({ message: 'GDELT rate limited; circuit opened', failureClass: 'rate_limited' });
    await expect(fetchGdeltJson('https://api.gdeltproject.org/api/v2/doc/doc'))
      .rejects.toMatchObject({ failureClass: 'cooldown' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('HTTP failures stay failures and do not become an empty article list', async () => {
    fetchMock.mockResolvedValue(response({ status: 503, ok: false, body: 'temporarily unavailable' }));

    await expect(fetchGdeltJson('https://api.gdeltproject.org/api/v2/doc/doc'))
      .rejects.toMatchObject({ message: 'GDELT HTTP 503', failureClass: 'upstream_http' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('rejects oversized responses before JSON parsing', async () => {
    const body = ' '.repeat(2 * 1024 * 1024 + 1);
    fetchMock.mockResolvedValue(response({ body }));

    await expect(fetchGdeltJson('https://api.gdeltproject.org/api/v2/doc/doc'))
      .rejects.toMatchObject({ message: 'GDELT response exceeded the configured body limit', failureClass: 'upstream_protocol' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('serializes concurrent callers so they cannot issue parallel requests', async () => {
    let releaseFirst;
    fetchMock
      .mockImplementationOnce(() => new Promise(resolve => {
        releaseFirst = () => resolve(response({ body: JSON.stringify({ articles: [] }) }));
      }))
      .mockResolvedValue(response({ body: JSON.stringify({ articles: [] }) }));

    const first = fetchGdeltJson('https://api.gdeltproject.org/api/v2/doc/doc?query=one');
    const second = fetchGdeltJson('https://api.gdeltproject.org/api/v2/doc/doc?query=two');
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    releaseFirst();
    await expect(first).resolves.toMatchObject({ articles: [] });
    // Advance the cadence without sleeping 15 seconds in the suite.
    jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 60_000);
    await expect(second).resolves.toMatchObject({ articles: [] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
