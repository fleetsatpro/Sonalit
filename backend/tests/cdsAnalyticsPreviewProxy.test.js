'use strict';

const handler = require('../../api/cds-analytics');

function makeResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    setHeader(name, value) { this.headers[name] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    send(body) { this.body = body; return this; },
  };
}

describe('same-origin CDS analytics preview proxy', () => {
  const originalBase = process.env.CDS_ANALYTICS_PREVIEW_API_BASE_URL;
  const originalFetch = global.fetch;

  afterEach(() => {
    if (originalBase === undefined) delete process.env.CDS_ANALYTICS_PREVIEW_API_BASE_URL;
    else process.env.CDS_ANALYTICS_PREVIEW_API_BASE_URL = originalBase;
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('forwards only the reporting window and supported auth headers to the HTTPS analytics endpoint', async () => {
    process.env.CDS_ANALYTICS_PREVIEW_API_BASE_URL = 'https://cds-analytics-preview-production.up.railway.app/api/v1/cds';
    global.fetch = jest.fn().mockResolvedValue({
      status: 200,
      headers: { get: () => 'application/json; charset=utf-8' },
      text: async () => '{"data":{"summary":{"active_trips":4}}}',
    });
    const req = {
      method: 'GET',
      query: { days: '30' },
      headers: {
        authorization: 'Bearer test-token',
        'x-field-device': 'device-token',
        'x-field-token': 'shift-token',
        cookie: 'must-not-be-forwarded',
        origin: 'https://untrusted.example',
      },
    };
    const res = makeResponse();

    await handler(req, res);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, options] = global.fetch.mock.calls[0];
    expect(String(url)).toBe('https://cds-analytics-preview-production.up.railway.app/api/v1/cds/analytics?days=30');
    expect(options.method).toBe('GET');
    expect(options.headers).toMatchObject({
      authorization: 'Bearer test-token',
      'x-field-device': 'device-token',
      'x-field-token': 'shift-token',
    });
    expect(options.headers.cookie).toBeUndefined();
    expect(options.headers.origin).toBeUndefined();
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('"active_trips":4');
    expect(res.headers['Cache-Control']).toContain('no-store');
  });

  it('rejects unsupported windows without contacting the upstream', async () => {
    process.env.CDS_ANALYTICS_PREVIEW_API_BASE_URL = 'https://cds-analytics-preview-production.up.railway.app/api/v1/cds';
    global.fetch = jest.fn();
    const res = makeResponse();

    await handler({ method: 'GET', query: { days: '14' }, headers: {} }, res);

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('invalid_analytics_window');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('returns 405 for non-GET methods', async () => {
    const res = makeResponse();

    await handler({ method: 'POST', query: {}, headers: {} }, res);

    expect(res.statusCode).toBe(405);
    expect(res.headers.Allow).toBe('GET');
  });

  it('surfaces an upstream connectivity failure as an HTTP 502 instead of a browser network error', async () => {
    process.env.CDS_ANALYTICS_PREVIEW_API_BASE_URL = 'https://cds-analytics-preview-production.up.railway.app/api/v1/cds';
    global.fetch = jest.fn().mockRejectedValue(new Error('socket timeout'));
    const res = makeResponse();

    await handler({ method: 'GET', query: { days: '7' }, headers: {} }, res);

    expect(res.statusCode).toBe(502);
    expect(res.body.error).toBe('analytics_preview_upstream_unavailable');
    expect(res.body.message).toBeDefined();
  });
});
