/**
 * generate-openapi.js
 * Introspects the Express app's router stack and emits backend/openapi.json.
 * Run manually or via CI to detect route drift.
 *
 * Usage:  node scripts/generate-openapi.js
 * Check:  node scripts/generate-openapi.js --check
 *           exits 1 if the committed openapi.json is out of date.
 */
'use strict';

// Prevent real DB/Redis connections and server startup during introspection
process.env.DATABASE_URL = '';
process.env.REDIS_URL = '';
process.env.JWT_SECRET = 'generate-openapi-placeholder';
process.env.DISABLE_REDIS = 'true';
process.env.GENERATE_OPENAPI = '1';

const fs = require('fs');
const path = require('path');

const OUT_FILE = path.resolve(__dirname, '../openapi.json');
const checkMode = process.argv.includes('--check');

// ─── Load the app ─────────────────────────────────────────────────────────────
let appModule;
try {
  appModule = require('../src/app');
} catch (err) {
  console.error('Failed to load app:', err.message);
  process.exit(1);
}
const { app } = appModule;

// ─── Walk Express router stack ────────────────────────────────────────────────
function extractPrefix(layer) {
  if (!layer || !layer.regexp) return '';
  const regexp = layer.regexp;
  if (regexp.fast_slash) return '';

  const src = regexp.source;
  if (typeof src !== 'string' || !src.startsWith('^')) return '';

  // Express 4 path-to-regexp stores named mount parameters in layer.keys.
  // Preserve those names when descending into a parameterised child router;
  // dropping this prefix silently omits that router's API from OpenAPI.
  let route = src.slice(1).replace(/\(\?=\\\/\|\$\).*$/, '');
  route = route.replace(/\\\/\?$/, '');

  const keys = Array.isArray(layer.keys) ? layer.keys : [];
  let keyIndex = 0;
  route = route.replace(/\((?!\?)([^()]*)\)/g, match => {
    const key = keys[keyIndex++];
    return key ? ':' + String(key.name) : match;
  });

  route = route.replace(/\\\//g, '/').replace(/\\\./g, '.');
  route = route.replace(/\/+$/, '');
  if (!route || route === '/?' || route === '/') return '';
  return route.startsWith('/') ? route : '';
}
function collectRoutes(stack, base = '') {
  const routes = [];
  for (const layer of stack) {
    if (layer.route) {
      const fullPath = (base + layer.route.path).replace(/\/+/g, '/');
      const methods = Object.keys(layer.route.methods).filter(k => layer.route.methods[k]);
      for (const method of methods) {
        routes.push({ method: method.toUpperCase(), path: fullPath });
      }
    } else if (layer.handle && layer.handle.stack) {
      const prefix = extractPrefix(layer);
      collectRoutes(layer.handle.stack, base + prefix).forEach(r => routes.push(r));
    }
  }
  return routes;
}

const rawRoutes = collectRoutes(app._router ? app._router.stack : []);

// ─── Build OpenAPI 3.1 paths object ──────────────────────────────────────────
const paths = {};
for (const { method, path: routePath } of rawRoutes) {
  // Convert Express :param notation to {param} for OpenAPI
  const oaPath = routePath.replace(/:([a-zA-Z_]+)/g, '{$1}');
  if (!paths[oaPath]) paths[oaPath] = {};
  paths[oaPath][method.toLowerCase()] = {
    operationId: `${method.toLowerCase()}_${oaPath.replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '')}`,
    responses: { '200': { description: 'OK' } },
  };
}

// ─── Assemble spec ────────────────────────────────────────────────────────────
const spec = {
  openapi: '3.1.0',
  info: {
    title: 'Sonalit Fleet API',
    version: '2.1.0',
    description: 'Auto-generated from Express router introspection. Do not hand-edit — run generate-openapi.js.',
  },
  servers: [{ url: '/api/v1', description: 'Current server' }],
  paths,
};

const json = JSON.stringify(spec, null, 2) + '\n';

// ─── Write or check ───────────────────────────────────────────────────────────
function canonicalise(value) {
  if (Array.isArray(value)) return value.map(canonicalise);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = canonicalise(value[key]);
    return out;
  }
  return value;
}

if (checkMode) {
  let existing = '';
  try { existing = fs.readFileSync(OUT_FILE, 'utf8'); } catch (_) { /* file absent */ }

  let upToDate = existing.trimEnd() === json.trimEnd();
  if (!upToDate && existing) {
    // JSON object-key order is not part of the OpenAPI data model. The previous
    // byte-for-byte check reported false drift whenever a path or operation was
    // inserted in a different order, even though the contract was identical.
    try {
      const generatedCanonical = JSON.stringify(canonicalise(spec));
      const existingCanonical = JSON.stringify(canonicalise(JSON.parse(existing)));
      upToDate = existingCanonical === generatedCanonical;
    } catch (_) {
      upToDate = false;
    }
  }

  if (!upToDate) {
    console.error('openapi.json is out of date. Run: node backend/scripts/generate-openapi.js');
    process.exit(1);
  }
  console.log('openapi.json is up to date.');
} else {
  fs.writeFileSync(OUT_FILE, json);
  const count = Object.keys(paths).length;
  console.log(`Wrote ${OUT_FILE} (${count} paths, ${rawRoutes.length} operations)`);
}

// Release DB pool so the process exits cleanly
try {
  const { pool } = require('../src/config/database');
  pool.end().catch(() => {});
} catch (_) {}
process.exit(0);
