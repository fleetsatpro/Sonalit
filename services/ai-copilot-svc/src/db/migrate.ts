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

    // ── Knowledge Fabric (spec §17-19) ─────────────────────────────────────
    // pgvector is required. It is NOT in the stock postgres image, which is
    // why docker-compose.dev.yml runs pgvector/pgvector:pg16. If this fails
    // in a managed environment, the extension must be enabled there first —
    // the RAG features degrade to unavailable rather than wrong (Rule 3).
    await client.query(`CREATE EXTENSION IF NOT EXISTS vector;`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS ai_documents (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id        UUID        NOT NULL,
        title         TEXT        NOT NULL,
        doc_type      TEXT        NOT NULL
                        CHECK (doc_type IN ('sop','policy','manual','report',
                                            'incident','procedure','route_doc','other')),
        -- Where this came from in Sonalit, so a retrieved chunk can be cited
        -- back to an authoritative record rather than floating free (§39).
        source_table  TEXT,
        source_id     TEXT,
        uri           TEXT,
        -- §18: retrieval filters on these BEFORE building model context.
        -- Data above a model's clearance must never enter its prompt.
        required_role TEXT        NOT NULL DEFAULT 'analyst'
                        CHECK (required_role IN ('admin','dispatcher','operator','analyst','cfo')),
        classification TEXT       NOT NULL DEFAULT 'operational'
                        CHECK (classification IN ('public','internal','operational',
                                                  'sensitive','restricted')),
        language      TEXT        NOT NULL DEFAULT 'en',
        -- §19 temporal knowledge: when the content became true, and when it
        -- stopped being true. Superseded guidance must not outrank current.
        valid_from    TIMESTAMPTZ,
        valid_until   TIMESTAMPTZ,
        superseded_by UUID        REFERENCES ai_documents (id),
        checksum      TEXT        NOT NULL,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (org_id, checksum)
      );
    `);

    // Chunks carry a denormalised copy of the parent's permission and
    // validity columns. That is deliberate: retrieval filters on them inside
    // the vector search, and a join would either force a slower plan or
    // tempt a future caller into filtering AFTER retrieval — which is
    // exactly the ordering §18 forbids.
    await client.query(`
      CREATE TABLE IF NOT EXISTS ai_document_chunks (
        id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        document_id    UUID        NOT NULL REFERENCES ai_documents (id) ON DELETE CASCADE,
        org_id         UUID        NOT NULL,
        chunk_index    INTEGER     NOT NULL,
        content        TEXT        NOT NULL,
        token_estimate INTEGER     NOT NULL,
        -- Vectors from different models occupy different spaces and are not
        -- comparable. Retrieval MUST filter on embedding_model; the column
        -- exists so that constraint can be enforced rather than assumed.
        embedding      VECTOR(1024) NOT NULL,
        embedding_model TEXT       NOT NULL,
        required_role  TEXT        NOT NULL,
        classification TEXT        NOT NULL,
        valid_from     TIMESTAMPTZ,
        valid_until    TIMESTAMPTZ,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (document_id, chunk_index)
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_ai_documents_org
        ON ai_documents (org_id, doc_type);
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_ai_chunks_org_model
        ON ai_document_chunks (org_id, embedding_model);
    `);
    // Full-text index backs the keyword half of hybrid retrieval (§34):
    // vector search alone misses exact identifiers — a registration plate or
    // a booking reference — which operators search for constantly.
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_ai_chunks_fts
        ON ai_document_chunks USING GIN (to_tsvector('simple', content));
    `);
    // IVFFlat over cosine distance. Built after ingestion in practice; with
    // an empty table Postgres still accepts it and the planner falls back to
    // a sequential scan until there are enough rows to matter.
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_ai_chunks_embedding
        ON ai_document_chunks USING ivfflat (embedding vector_cosine_ops)
        WITH (lists = 100);
    `);

    for (const table of ['ai_documents', 'ai_document_chunks']) {
      await client.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`);
      await client.query(`DROP POLICY IF EXISTS ${table}_org_isolation ON ${table};`);
      await client.query(`
        CREATE POLICY ${table}_org_isolation ON ${table}
          USING (org_id = current_setting('app.current_org_id', TRUE)::UUID)
          WITH CHECK (org_id = current_setting('app.current_org_id', TRUE)::UUID);
      `);
    }

    // Candidate open-weight embedding models (§4.6, §5). Both are genuinely
    // open source, multilingual (EN/FR per §4.4), and emit 1024 dimensions,
    // matching ai_document_chunks.embedding.
    //
    // Registered as 'experimental' and NOT approved for production, because
    // no inference endpoint exists yet — see the STOP gate in
    // docs/ai/ARCHITECTURE_AUDIT.md. The production gate therefore filters
    // them out, and retrieval reports itself unavailable rather than
    // returning wrong results (Rule 3). Promote them once EMBEDDING_ENDPOINT
    // points at a real server and the §53 evaluation suite passes.
    await client.query(
      `INSERT INTO ai_models (
         name, version, provider, provider_model, capabilities,
         license, license_is_open_source, self_hosted, context_length,
         endpoint, max_data_classification, supports_tools, supports_streaming,
         routing_priority, status, approved_for_production
       ) VALUES
         ('bge-m3', '1', 'openai_compatible', 'BAAI/bge-m3',
          ARRAY['embedding'], 'MIT', TRUE, TRUE, 8192,
          $1, 'restricted', FALSE, FALSE, 5, 'experimental', FALSE),
         ('multilingual-e5-large', '1', 'openai_compatible',
          'intfloat/multilingual-e5-large',
          ARRAY['embedding'], 'MIT', TRUE, TRUE, 512,
          $1, 'restricted', FALSE, FALSE, 6, 'experimental', FALSE)
       ON CONFLICT (name, version) DO NOTHING;`,
      [process.env['EMBEDDING_ENDPOINT'] ?? null],
    );

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
