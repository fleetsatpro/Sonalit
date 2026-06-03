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
function extractPrefix(regexp) {
  if (!regexp) return '';
  const src = regexp.source;
  // Match /^\/some\/path\/?(?=...) patterns
  const m = src.match(/^\^\\\/(.+?)(?:\\\/\?\(\?=|\\\/\?$|\(\?=)/);
  if (!m) return '';
  return '/' + m[1].replace(/\\\//g, '/').replace(/\\\./g, '.');
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
      const prefix = extractPrefix(layer.regexp);
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
if (checkMode) {
  let existing = '';
  try { existing = fs.readFileSync(OUT_FILE, 'utf8'); } catch (_) { /* file absent */ }
  if (existing.trimEnd() !== json.trimEnd()) {
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
