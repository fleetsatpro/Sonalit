'use strict';

// Same-origin, preview-only proxy for the authenticated CDS analytics read.
// The browser never needs cross-origin CORS access to the Railway preview API.
// This function accepts no writes and forwards only the analytics endpoint.
const ALLOWED_DAYS = new Set(['7', '30', '90', '365']);
const FORWARDED_HEADERS = [
  'authorization',
  'x-field-device',
  'x-field-token',
  'x-request-id',
];

module.exports = async function cdsAnalyticsPreview(req, res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Vary', 'Authorization, X-Field-Device, X-Field-Token');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const upstreamBase = String(process.env.CDS_ANALYTICS_PREVIEW_API_BASE_URL || '').trim();
  if (!upstreamBase) {
    return res.status(503).json({ error: 'analytics_preview_proxy_not_configured' });
  }

  const rawDays = req.query && req.query.days !== undefined ? req.query.days : '30';
  if (typeof rawDays !== 'string' || !ALLOWED_DAYS.has(rawDays)) {
    return res.status(400).json({
      error: 'invalid_analytics_window',
      allowed_days: [7, 30, 90, 365],
    });
  }

  let upstreamUrl;
  try {
    upstreamUrl = new URL(upstreamBase.replace(/\/+$/, '') + '/analytics');
    if (upstreamUrl.protocol !== 'https:') {
      return res.status(500).json({ error: 'analytics_preview_upstream_must_use_https' });
    }
    upstreamUrl.searchParams.set('days', rawDays);
  } catch (_error) {
    return res.status(500).json({ error: 'analytics_preview_upstream_misconfigured' });
  }

  const headers = { Accept: 'application/json' };
  for (const name of FORWARDED_HEADERS) {
    const value = req.headers && req.headers[name];
    if (typeof value === 'string' && value.length > 0) headers[name] = value;
  }

  try {
    const upstream = await fetch(upstreamUrl, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(12_000),
      redirect: 'error',
    });
    const body = await upstream.text();
    res.status(upstream.status);
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json; charset=utf-8');
    return res.send(body);
  } catch (error) {
    console.error('[cds-analytics-preview-proxy] upstream request failed:', error && error.name ? error.name : 'Error');
    return res.status(502).json({
      error: 'analytics_preview_upstream_unavailable',
      message: 'The preview analytics service did not return a response.',
    });
  }
};
