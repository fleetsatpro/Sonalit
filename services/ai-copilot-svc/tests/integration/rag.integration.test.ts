// End-to-end verification against a real Postgres with pgvector.
//
// These cover what unit tests structurally cannot: that the migrations
// apply, that the RLS policies actually isolate tenants, and that the
// retrieval SQL — a CTE with reciprocal-rank fusion over two candidate
// sets — parses, runs and returns the right rows. Every one of those was
// previously asserted only as a string.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { Pool } from 'pg';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import {
  DATABASE_URL,
  ORG_A,
  ORG_B,
  PLATFORM_FIXTURE_SQL,
  hasDatabase,
  startFakeEmbeddingServer,
} from './setup.js';

// Types are imported statically; the modules themselves are imported
// lazily in beforeAll, after DATABASE_URL is set — src/config.ts parses
// process.env at module load, so importing early would bind the wrong URL.
import type { withOrgContext as WithOrgContext } from '../../src/db.js';
import type { ingestDocument as IngestDocument } from '../../src/rag/ingest.js';
import type { retrieve as Retrieve } from '../../src/rag/retrieve.js';
import type { executeTool as ExecuteTool } from '../../src/tools/index.js';

const run = promisify(execFile);
const describeIf = hasDatabase ? describe : describe.skip;

let pool: Pool;
let server: Awaited<ReturnType<typeof startFakeEmbeddingServer>>;
let withOrgContext: typeof WithOrgContext;
let ingestDocument: typeof IngestDocument;
let retrieve: typeof Retrieve;
let executeTool: typeof ExecuteTool;

const SOP = [
  'Escort vehicles travel at the rear of convoy KXX123X.',
  'The corridor buffer is three hundred metres on the A109.',
  'Report any corridor deviation to the operations room immediately.',
].join('\n\n');

describeIf('RAG against real Postgres + pgvector', () => {
  beforeAll(async () => {
    server = await startFakeEmbeddingServer();
    process.env['DATABASE_URL'] = DATABASE_URL;
    process.env['NODE_ENV'] = 'test';
    process.env['REDIS_URL'] ??= 'redis://127.0.0.1:6379';

    await run('npx', ['tsx', 'src/db/migrate.ts'], {
      env: { ...process.env, DATABASE_URL },
    });

    pool = new Pool({ connectionString: DATABASE_URL });
    // Point the registered embedding model at the fake server and promote
    // it, so the router selects it exactly as it would in production.
    await pool.query(
      `UPDATE ai_models SET endpoint = $1, status = 'production', approved_for_production = TRUE
        WHERE name = 'bge-m3'`,
      [server.url],
    );
    await pool.query('TRUNCATE ai_document_chunks, ai_documents CASCADE');
    await pool.query(PLATFORM_FIXTURE_SQL);

    ({ withOrgContext } = await import('../../src/db.js'));
    ({ ingestDocument } = await import('../../src/rag/ingest.js'));
    ({ retrieve } = await import('../../src/rag/retrieve.js'));
    ({ executeTool } = await import('../../src/tools/index.js'));
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    await server?.close();
  });

  it('applies the migrations, including pgvector and the RLS policies', async () => {
    const ext = await pool.query<{ n: string }>(
      `SELECT COUNT(*) AS n FROM pg_extension WHERE extname = 'vector'`,
    );
    expect(Number(ext.rows[0]?.n)).toBe(1);

    const policies = await pool.query<{ tablename: string }>(
      `SELECT tablename FROM pg_policies WHERE tablename LIKE 'ai\\_%'`,
    );
    expect(policies.rows.map((r) => r.tablename)).toEqual(
      expect.arrayContaining([
        'ai_documents',
        'ai_document_chunks',
        'ai_signals',
        'ai_correlations',
        'ai_audit_log',
      ]),
    );
  });

  // withOrgContext does SET LOCAL ROLE sonalit_app, which fails outright if
  // the role is missing or lacks grants on these tables. Both were real
  // failures before the migration provisioned them.
  it('provisions the sonalit_app role with grants on the AI tables', async () => {
    const role = await pool.query<{ n: string }>(
      `SELECT COUNT(*) AS n FROM pg_roles WHERE rolname = 'sonalit_app'`,
    );
    expect(Number(role.rows[0]?.n)).toBe(1);

    const granted = await pool.query<{ n: string }>(
      `SELECT COUNT(*) AS n FROM information_schema.role_table_grants
        WHERE grantee = 'sonalit_app' AND table_name = 'ai_document_chunks'
          AND privilege_type = 'SELECT'`,
    );
    expect(Number(granted.rows[0]?.n)).toBe(1);
  });

  it('ingests, chunks, embeds and retrieves a document', async () => {
    const result = await withOrgContext(ORG_A, (c) =>
      ingestDocument({ title: 'Convoy Escort SOP', doc_type: 'sop', content: SOP }, ORG_A, c),
    );

    expect(result.deduplicated).toBe(false);
    expect(result.chunks).toBeGreaterThan(0);

    const hits = await withOrgContext(ORG_A, (c) =>
      retrieve(
        { query: 'corridor buffer A109', role: 'operator', max_classification: 'operational' },
        c,
      ),
    );

    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.title).toBe('Convoy Escort SOP');
    expect(hits[0]?.content).toContain('corridor');
  });

  it('reuses an identical document instead of re-indexing it', async () => {
    const again = await withOrgContext(ORG_A, (c) =>
      ingestDocument({ title: 'Convoy Escort SOP', doc_type: 'sop', content: SOP }, ORG_A, c),
    );

    expect(again.deduplicated).toBe(true);
    const count = await pool.query<{ n: string }>('SELECT COUNT(*) AS n FROM ai_documents');
    expect(Number(count.rows[0]?.n)).toBe(1);
  });

  // The chunk's embedding key must be the model's identity, not the
  // registry row id: re-registering a model mints a new UUID, and keying on
  // that would make every existing chunk unreachable — the index would go
  // silently dark.
  it('keeps chunks retrievable after the model row is re-registered', async () => {
    const stored = await pool.query<{ embedding_model: string }>(
      'SELECT DISTINCT embedding_model FROM ai_document_chunks',
    );
    expect(stored.rows[0]?.embedding_model).toBe('BAAI/bge-m3');

    await pool.query(`UPDATE ai_models SET model_id = gen_random_uuid() WHERE name = 'bge-m3'`);

    const hits = await withOrgContext(ORG_A, (c) =>
      retrieve(
        { query: 'corridor buffer A109', role: 'operator', max_classification: 'operational' },
        c,
      ),
    );
    expect(hits.length).toBeGreaterThan(0);
  });

  // §59 — the P0 guarantee, verified against real policies rather than
  // against a mock that could only ever confirm the SQL string.
  it('returns nothing to another tenant', async () => {
    const hits = await withOrgContext(ORG_B, (c) =>
      retrieve(
        { query: 'corridor buffer A109', role: 'admin', max_classification: 'restricted' },
        c,
      ),
    );
    expect(hits).toEqual([]);
  });

  it('refuses a cross-tenant write at the database level', async () => {
    await expect(
      withOrgContext(ORG_A, (c) =>
        c.query(
          `INSERT INTO ai_signals (org_id, type, severity, entity_type, entity_id, observed_at, source)
           VALUES ($1,'panic','info','vehicle','evil', NOW(), 'test')`,
          [ORG_B],
        ),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  // §18 — filtering happens inside the query, so an under-cleared request
  // retrieves nothing rather than retrieving and then discarding.
  it('excludes documents above the request’s classification ceiling', async () => {
    const hits = await withOrgContext(ORG_A, (c) =>
      retrieve({ query: 'corridor buffer', role: 'operator', max_classification: 'public' }, c),
    );
    expect(hits).toEqual([]);
  });

  it('excludes documents above the caller’s role', async () => {
    await withOrgContext(ORG_A, (c) =>
      ingestDocument(
        {
          title: 'Admin-only Directive',
          doc_type: 'policy',
          content: 'Restricted corridor guidance for administrators only.',
          required_role: 'admin',
        },
        ORG_A,
        c,
      ),
    );

    const asAnalyst = await withOrgContext(ORG_A, (c) =>
      retrieve(
        {
          query: 'restricted corridor guidance',
          role: 'analyst',
          max_classification: 'operational',
        },
        c,
      ),
    );
    expect(asAnalyst.map((h) => h.title)).not.toContain('Admin-only Directive');

    const asAdmin = await withOrgContext(ORG_A, (c) =>
      retrieve(
        { query: 'restricted corridor guidance', role: 'admin', max_classification: 'operational' },
        c,
      ),
    );
    expect(asAdmin.map((h) => h.title)).toContain('Admin-only Directive');
  });

  // §19 — a rescinded SOP must not be cited as current.
  it('excludes expired documents unless history is requested', async () => {
    await withOrgContext(ORG_A, (c) =>
      ingestDocument(
        {
          title: 'Superseded Routing Note',
          doc_type: 'procedure',
          content: 'Legacy corridor routing via the old B12 alignment.',
          valid_until: new Date(Date.now() - 86_400_000),
        },
        ORG_A,
        c,
      ),
    );

    const current = await withOrgContext(ORG_A, (c) =>
      retrieve(
        { query: 'legacy corridor routing B12', role: 'admin', max_classification: 'operational' },
        c,
      ),
    );
    expect(current.map((h) => h.title)).not.toContain('Superseded Routing Note');

    const historical = await withOrgContext(ORG_A, (c) =>
      retrieve(
        {
          query: 'legacy corridor routing B12',
          role: 'admin',
          max_classification: 'operational',
          include_expired: true,
        },
        c,
      ),
    );
    const found = historical.find((h) => h.title === 'Superseded Routing Note');
    expect(found).toBeDefined();
    expect(found?.stale).toBe(true);
  });

  // The tool layer's SQL had never executed either. These run it for real:
  // an interval cast, a JOIN against convoys, and JSONB round-tripping
  // through Zod are all things a mocked client cannot verify.
  describe('tools against the real schema', () => {
    it('scores convoy risk from stored signals', async () => {
      const convoyId = 'convoy-integration-1';
      await withOrgContext(ORG_A, (c) =>
        c.query(
          `INSERT INTO ai_signals (org_id, type, severity, entity_type, entity_id,
                                   convoy_id, observed_at, payload, source)
           VALUES ($1,'panic','critical','vehicle','veh-1',$2, NOW(), '{}'::jsonb, 'test'),
                  ($1,'comms_silence','warning','vehicle','veh-1',$2, NOW(), '{}'::jsonb, 'test')`,
          [ORG_A, convoyId],
        ),
      );

      const result = await executeTool(
        'assess_convoy_risk',
        { convoy_id: convoyId },
        { org_id: ORG_A, user_id: 'u1', role: 'operator', request_id: 'r1' },
      );

      expect(result.error).toBeUndefined();
      expect(result.success).toBe(true);
      const data = result.data as {
        score: number;
        band: string;
        probability: number | null;
        contributing_factors: { name: string }[];
      };
      expect(data.score).toBeGreaterThan(0);
      expect(data.band).toBe('critical');
      // §21 — no probability while the model is uncalibrated.
      expect(data.probability).toBeNull();
      expect(data.contributing_factors.map((f) => f.name)).toContain('panic');
    });

    it('does not score another tenant’s convoy', async () => {
      const result = await executeTool(
        'assess_convoy_risk',
        { convoy_id: 'convoy-integration-1' },
        { org_id: ORG_B, user_id: 'u2', role: 'admin', request_id: 'r2' },
      );

      expect(result.success).toBe(true);
      const data = result.data as { score: number; warnings: string[] };
      expect(data.score).toBe(0);
      // Rule 4 — zero must be reported as "nothing observed", not as safe.
      expect(data.warnings.join(' ')).toContain('not that the convoy is confirmed safe');
    });

    it('runs the fleet read tools against the real tables', async () => {
      const result = await executeTool(
        'query_risk_zones',
        { risk_level: 'high' },
        { org_id: ORG_A, user_id: 'u1', role: 'operator', request_id: 'r3' },
      );

      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
    });
  });
});
