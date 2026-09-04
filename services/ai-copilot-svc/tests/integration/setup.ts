// Integration test harness.
//
// The database comes from TEST_DATABASE_URL, pointing at a Postgres with
// the pgvector extension available:
//
//   docker compose -f docker-compose.dev.yml up -d postgres
//   TEST_DATABASE_URL=postgres://sonalit:dev-password@localhost:5432/sonalit \
//     pnpm test:integration
//
// Other v4 services use testcontainers, which is not used here on purpose:
// it needs a Docker daemon, and these tests must also run in CI images and
// sandboxes that have Postgres but no Docker. The suite runs the real
// migrations against whatever URL it is given, so it verifies the same
// things either way.
//
// With no TEST_DATABASE_URL the suite SKIPS rather than fails — a developer
// without a database should not see a red build for infrastructure they
// were never asked to run, and the gap is visible in the skip output.

import { createServer, type Server } from 'node:http';

import type { AddressInfo } from 'node:net';

export const EMBEDDING_DIM = 1024;

/**
 * A deterministic stand-in for a real embedding server, speaking the
 * OpenAI-compatible protocol.
 *
 * Real weights are not needed to test the pipeline, and using them would
 * make assertions depend on a model download. What IS exercised for real:
 * the openai_compatible adapter, its HTTP handling, pgvector storage, the
 * vector operators and every SQL filter.
 */
export async function startFakeEmbeddingServer(): Promise<{
  url: string;
  close: () => Promise<void>;
}> {
  const server: Server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += String(chunk)));
    req.on('end', () => {
      const parsed = JSON.parse(body || '{}') as { input?: string | string[] };
      const items = Array.isArray(parsed.input) ? parsed.input : [parsed.input ?? ''];
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          data: items.map((text, index) => ({ index, embedding: embed(String(text)) })),
          usage: { prompt_tokens: items.length * 10 },
        }),
      );
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${String(port)}/v1`,
    close: () =>
      new Promise<void>((resolve) =>
        server.close(() => {
          resolve();
        }),
      ),
  };
}

/**
 * Token-overlap embedding: texts sharing words land near each other, so
 * similarity ordering is meaningful rather than arbitrary.
 */
function embed(text: string): number[] {
  const vector = new Array<number>(EMBEDDING_DIM).fill(0);
  for (const token of text.toLowerCase().split(/\W+/).filter(Boolean)) {
    let hash = 0;
    for (const ch of token) hash = (hash * 31 + ch.charCodeAt(0)) % EMBEDDING_DIM;
    vector[hash] = (vector[hash] ?? 0) + 1;
  }
  const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0)) || 1;
  return vector.map((v) => v / norm);
}

export const DATABASE_URL = process.env['TEST_DATABASE_URL'];
export const hasDatabase = typeof DATABASE_URL === 'string' && DATABASE_URL.length > 0;

export const ORG_A = '00000000-0000-4000-8000-0000000000aa';
export const ORG_B = '00000000-0000-4000-8000-0000000000bb';

/**
 * Minimal stand-ins for the platform tables the AI tools read.
 *
 * The legacy backend owns the real schema; this service's migrations do not
 * create it. Rather than depend on the full backend migration set, the
 * suite creates just the columns the tools actually select — enough to
 * prove the SQL parses, joins and casts correctly against real Postgres.
 * Columns are intentionally permissive: this fixture verifies the queries,
 * not the platform's constraints.
 */
export const PLATFORM_FIXTURE_SQL = `
  CREATE TABLE IF NOT EXISTS convoys (
    id TEXT PRIMARY KEY, org_id UUID, name TEXT, status TEXT, region TEXT,
    priority TEXT, route_origin TEXT, route_destination TEXT,
    departure_time TIMESTAMPTZ, estimated_arrival TIMESTAMPTZ,
    arrival_time TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
  );
  CREATE TABLE IF NOT EXISTS vehicles (
    id TEXT PRIMARY KEY, org_id UUID, registration TEXT, type TEXT, status TEXT,
    region TEXT, fuel_level NUMERIC, speed NUMERIC, latitude NUMERIC,
    longitude NUMERIC, driver_name TEXT, last_ping TIMESTAMPTZ,
    deleted_at TIMESTAMPTZ
  );
  CREATE TABLE IF NOT EXISTS alerts (
    id TEXT PRIMARY KEY, org_id UUID, vehicle_id TEXT, convoy_id TEXT,
    type TEXT, severity TEXT, message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(), acknowledged_at TIMESTAMPTZ,
    resolved_at TIMESTAMPTZ, deleted_at TIMESTAMPTZ
  );
  CREATE TABLE IF NOT EXISTS risk_zones (
    id TEXT PRIMARY KEY, org_id UUID, name TEXT, description TEXT,
    risk_level TEXT, zone_type TEXT, lat NUMERIC, lng NUMERIC,
    radius_km NUMERIC, active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );
  GRANT SELECT, INSERT, UPDATE, DELETE ON convoys, vehicles, alerts, risk_zones
    TO sonalit_app;
`;

/**
 * A scripted OpenAI-compatible chat endpoint.
 *
 * Commander's loop — routing, tool dispatch, evidence classification, the
 * budget checks — is provider-agnostic, so exercising it needs a server
 * that speaks the protocol, not real weights. This one asks for a named
 * tool on its first turn and answers once it sees the result, which is the
 * shape of every real investigation.
 */
export async function startScriptedChatServer(
  toolName: string,
  toolArgs: object,
): Promise<{
  url: string;
  close: () => Promise<void>;
}> {
  const server: Server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += String(chunk)));
    req.on('end', () => {
      const payload = JSON.parse(body || '{}') as {
        input?: string | string[];
        messages?: { role: string; content?: string }[];
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });

      if ((req.url ?? '').includes('/embeddings')) {
        const items = Array.isArray(payload.input) ? payload.input : [payload.input ?? ''];
        res.end(
          JSON.stringify({
            data: items.map((_t, index) => ({
              index,
              embedding: new Array(EMBEDDING_DIM).fill(0.1),
            })),
            usage: { prompt_tokens: 10 },
          }),
        );
        return;
      }

      const sawToolResult = (payload.messages ?? []).some((m) => m.role === 'tool');
      if (!sawToolResult) {
        res.end(
          JSON.stringify({
            choices: [
              {
                finish_reason: 'tool_calls',
                message: {
                  content: null,
                  tool_calls: [
                    {
                      id: 'call-1',
                      type: 'function',
                      function: { name: toolName, arguments: JSON.stringify(toolArgs) },
                    },
                  ],
                },
              },
            ],
            usage: { prompt_tokens: 50, completion_tokens: 10 },
          }),
        );
        return;
      }

      res.end(
        JSON.stringify({
          choices: [
            { finish_reason: 'stop', message: { content: 'SITUATION — assessment complete.' } },
          ],
          usage: { prompt_tokens: 80, completion_tokens: 20 },
        }),
      );
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${String(port)}/v1`,
    close: () =>
      new Promise<void>((resolve) =>
        server.close(() => {
          resolve();
        }),
      ),
  };
}
