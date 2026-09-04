import { pool } from '../db.js';

async function migrate(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS ai_decisions (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id      UUID        NOT NULL,
        user_id     UUID        NOT NULL,
        query       TEXT        NOT NULL,
        response    TEXT        NOT NULL,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_ai_decisions_org_id
        ON ai_decisions (org_id, created_at DESC);
    `);

    // ── Model Registry (spec §6) ───────────────────────────────────────────
    // Every model that may process Sonalit data is a row here. Code holds
    // no model identifiers: routes ask for a capability, the router reads
    // this table. Swapping a hosted model for a self-hosted open-weight
    // endpoint is an UPDATE, not a deploy.
    await client.query(`
      CREATE TABLE IF NOT EXISTS ai_models (
        model_id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name                    TEXT        NOT NULL,
        version                 TEXT        NOT NULL,
        provider                TEXT        NOT NULL
                                  CHECK (provider IN ('anthropic', 'openai_compatible')),
        provider_model          TEXT        NOT NULL,
        capabilities            TEXT[]      NOT NULL,
        -- Spec §5: "open weight" is not "open source". The licence text and
        -- whether it is genuinely OSI-open are recorded separately so legal
        -- can audit production models without inferring either.
        license                 TEXT        NOT NULL,
        license_is_open_source  BOOLEAN     NOT NULL,
        self_hosted             BOOLEAN     NOT NULL DEFAULT FALSE,
        context_length          INTEGER     NOT NULL CHECK (context_length > 0),
        quantization            TEXT,
        hardware_profile        TEXT,
        endpoint                TEXT,
        -- Name of the env var holding the credential, never the credential.
        api_key_env             TEXT,
        max_data_classification TEXT        NOT NULL DEFAULT 'operational'
                                  CHECK (max_data_classification IN
                                    ('public','internal','operational','sensitive','restricted')),
        supports_tools          BOOLEAN     NOT NULL DEFAULT FALSE,
        supports_streaming      BOOLEAN     NOT NULL DEFAULT FALSE,
        -- Ascending by cost/size: §58 wants the smallest capable model first.
        routing_priority        INTEGER     NOT NULL DEFAULT 100,
        benchmark_score         NUMERIC(5,2),
        status                  TEXT        NOT NULL DEFAULT 'experimental'
                                  CHECK (status IN ('experimental','evaluation','staging',
                                                    'canary','production','retired')),
        approved_for_production BOOLEAN     NOT NULL DEFAULT FALSE,
        created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (name, version)
      );
    `);

    // Belt-and-braces on §55's promotion gate: a row cannot claim
    // production status without having been explicitly approved.
    await client.query(`
      ALTER TABLE ai_models DROP CONSTRAINT IF EXISTS ai_models_production_requires_approval;
    `);
    await client.query(`
      ALTER TABLE ai_models ADD CONSTRAINT ai_models_production_requires_approval
        CHECK (status <> 'production' OR approved_for_production);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_ai_models_routing
        ON ai_models (status, routing_priority) WHERE status <> 'retired';
    `);

    // ── AI audit log (spec §44) ────────────────────────────────────────────
    // One row per gateway request. Carries the model and prompt versions
    // that served it, the fallback chain that was walked, and the tools
    // invoked — enough to reconstruct why the system said what it said.
    await client.query(`
      CREATE TABLE IF NOT EXISTS ai_audit_log (
        id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id            UUID        NOT NULL,
        user_id           UUID,
        conversation_id   UUID,
        request_id        UUID        NOT NULL,
        capability        TEXT        NOT NULL,
        classification    TEXT        NOT NULL,
        model_id          UUID        REFERENCES ai_models (model_id),
        model_version     TEXT,
        prompt_version    TEXT,
        -- Ordered record of every model attempted, successful or not (§49).
        routing_attempts  JSONB       NOT NULL DEFAULT '[]'::JSONB,
        tools_invoked     JSONB       NOT NULL DEFAULT '[]'::JSONB,
        retrieved_sources JSONB       NOT NULL DEFAULT '[]'::JSONB,
        input_tokens      INTEGER,
        output_tokens     INTEGER,
        latency_ms        INTEGER,
        outcome           TEXT        NOT NULL
                            CHECK (outcome IN ('success','no_eligible_model',
                                               'all_models_failed','rejected','error')),
        error             TEXT,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_ai_audit_log_org
        ON ai_audit_log (org_id, created_at DESC);
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_ai_audit_log_request
        ON ai_audit_log (request_id);
    `);

    // Audit rows carry operational data and are read per-tenant, so they
    // get the same RLS treatment as the rest of the platform (§59).
    await client.query(`ALTER TABLE ai_audit_log ENABLE ROW LEVEL SECURITY;`);
    await client.query(`DROP POLICY IF EXISTS ai_audit_log_org_isolation ON ai_audit_log;`);
    await client.query(`
      CREATE POLICY ai_audit_log_org_isolation ON ai_audit_log
        USING (org_id = current_setting('app.current_org_id', TRUE)::UUID)
        WITH CHECK (org_id = current_setting('app.current_org_id', TRUE)::UUID);
    `);

    // Seed the registry with the two models this codebase previously
    // hardcoded (routes/ai.ts and backend/src/routes/ai.js), so behaviour
    // is unchanged on first deploy. Self-hosted open-weight rows are added
    // once an inference endpoint exists — see docs/ai/ARCHITECTURE_AUDIT.md.
    await client.query(`
      INSERT INTO ai_models (
        name, version, provider, provider_model, capabilities,
        license, license_is_open_source, self_hosted, context_length,
        api_key_env, max_data_classification, supports_tools, supports_streaming,
        routing_priority, status, approved_for_production
      ) VALUES
        ('claude-sonnet-4-6', '1', 'anthropic', 'claude-sonnet-4-6',
         ARRAY['fast_command','general','multilingual','vision'],
         'Proprietary — Anthropic Commercial Terms of Service', FALSE, FALSE, 200000,
         'ANTHROPIC_API_KEY', 'operational', TRUE, TRUE, 10, 'production', TRUE),
        ('claude-opus-4-7', '1', 'anthropic', 'claude-opus-4-7',
         ARRAY['general','reasoning','multilingual','vision'],
         'Proprietary — Anthropic Commercial Terms of Service', FALSE, FALSE, 200000,
         'ANTHROPIC_API_KEY', 'operational', TRUE, TRUE, 20, 'production', TRUE)
      ON CONFLICT (name, version) DO NOTHING;
    `);

    process.stdout.write('ai-copilot-svc migrations complete\n');
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch((err: Error) => {
  process.stderr.write(`Migration failed: ${err.message}\n`);
  process.exit(1);
});
