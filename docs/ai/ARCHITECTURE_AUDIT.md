# AI Operations Fabric — Phase 0 Architecture Audit

Status: **Phase 0 complete. STOP gate raised — see §3.**
Scope of this document: what exists today, what the AI plane may reuse, and
the one premise conflict that needs a decision before later phases proceed.

---

## 1. What already exists

The platform is **not** a blank slate for AI. Three surfaces are live today.

| Surface | Location | State |
|---|---|---|
| Copilot service (v4) | `services/ai-copilot-svc` | Fastify + Anthropic SDK. SSE streaming, Redis-backed sessions, global circuit breaker, `ai_decisions` audit table. |
| Dispatch assistant (legacy) | `backend/src/routes/ai.js` (782 lines) | A real agentic tool-use loop with 9 working tools: vehicles, convoys, alerts, weather, holidays, road conditions, risk zones, plus `create_geofence` / `create_risk_zone` mutations. |
| Provider fallback | `backend/src/utils/aiClient.js` | Anthropic primary → Groq open-weight fallback, with bidirectional tool/message translation and a cooldown circuit. |

Further AI-adjacent code: `utils/riskOsint.js`, `utils/routeAnalyser.js`,
`utils/captureVision.js`, `utils/extractionClient.js`, `utils/cdsIntelligence.js`.
Web surfaces: `apps/web/src/pages/Copilot.tsx`, `pages/AIDecision.tsx`.

**Implication for Rule 2.** `backend/src/utils/aiClient.js` is already a
two-provider abstraction and is the closest thing to the target model
fabric. The tool loop in `routes/ai.js` is the seed of the Tool Registry
(§10). Neither should be rewritten; both should be migrated behind the
fabric's interfaces.

## 2. Gaps against the specification

Verified absent, not merely undocumented:

- **No vector storage of any kind.** `grep` over all 90 migrations finds no
  `vector`, `embedding` or `tsvector` column. RAG (§17–19) starts from zero:
  pgvector is not installed. Note that `ai-copilot-svc/package.json`
  *describes itself* as "RAG over pgvector+OpenSearch" and depends on
  `@opensearch-project/opensearch` — **no such code exists**. The description
  and the dependency are aspirational; treat neither as a foundation.
- **No model abstraction.** Model ids were string literals in route files
  (`'claude-sonnet-4-6'`, `'claude-opus-4-7'`).
- **No model registry, router, policy, or evaluation harness.**
- **No self-hosted inference anywhere.** No GPU node pool in
  `infra/terraform`, no vLLM/Ollama/TGI in any Helm chart or in
  `docker-compose.dev.yml`.
- **No Watchtower, Digital Twin, GEOINT layer, or optimizer.**
- **`@sonalit/contracts` carries no AI schemas.**

## 3. STOP gate — premise conflict

> §67 Phase 0: "STOP if existing architecture conflicts with assumptions."

**It does.** The specification's central premise (§0, §5) is
*primarily self-hosted open-source/open-weight models*. The platform as
built is **hosted-API-first with no self-hosting capability at any layer**:
no GPU compute is provisioned, no inference server is deployed, and the
only open-weight path (`aiClient.js` → Groq) is itself a hosted API.

Closing that gap is an **infrastructure programme**, not a code change:
GPU node pools, an inference server deployment, VRAM/quantization
selection, model-weight distribution and licence review. It cannot be
delivered from application code alone, and its answer determines the
hardware budget for every later phase.

**This does not block the model fabric**, and that is why the fabric was
built first: a provider-neutral abstraction is the correct next step under
*either* answer. What it changes is which registry rows exist and what
infrastructure must be provisioned alongside them.

## 3b. Security findings (P0 — cross-tenant)

Spec §59: "Cross-tenant leakage is a P0 security defect." Two were found.

### F1 — The AI dispatch tools read across every tenant

`backend/src/routes/ai.js` mounts `authenticate` **only** — never
`attachOrgDb` — and all nine of its tools call the global `query()` from
`config/database.js`, which bypasses RLS by design. `query_vehicles`,
`query_convoys`, `query_alerts` and `query_risk_zones` therefore return
rows for **all organisations** to any authenticated user of any tenant.

Two further leaks in the same file: `GET /ai/anomalies` returned every
tenant's alerts, and `GET /ai/risk/:convoyId` let any tenant read any
convoy's risk posture by id (a cross-tenant IDOR).

Both `INSERT`s — `create_geofence` and `create_risk_zone` — also omitted
`org_id` entirely, writing rows with a NULL tenant. Those rows are
invisible to every org under RLS, and are rejected outright once the
policy's `WITH CHECK` applies.

*Status:* **FIXED.** The route now mounts `attachOrgDb` with the
`org_scope_required` guard, every tenant-data read goes through `req.db`,
and both `INSERT`s write the caller's `org_id`. The unscoped `query()`
remains only for the route's one-off schema-bootstrap DDL. Covered by
`backend/tests/ai-org-scoping.test.js`, which asserts both the runtime
behaviour and — as a guard against reintroduction — that no `SELECT` or
`INSERT` in the file uses the unscoped helper.

### F2 — v4 `withOrgContext` enforced nothing

Every v4 service shipped the same helper, which applied no isolation at
all for three independent reasons:

| Bug | Effect |
|---|---|
| No `BEGIN` | `SET LOCAL` outside a transaction is a no-op that only warns. |
| No `SET LOCAL ROLE sonalit_app` | Table owners and superusers **bypass RLS**; the service connects as the owner. |
| Setting named `app.org_id` | Every policy in the platform reads `app.current_org_id`, so policies evaluated NULL. |

*Status:* fixed in `services/ai-copilot-svc/src/db.ts`, matching
`backend/src/utils/orgScopedDb.js`. The AI plane was its first real caller,
so nothing had depended on it before.

A fourth defect only visible once the others were fixed: the statement
was written as `SET LOCAL app.org_id = $1`, and `SET LOCAL` takes a
literal, not a bind parameter. Postgres rejects that outright — so the
helper would have raised a syntax error on first use regardless.

*Status:* **FIXED** in all nine services — `ai-copilot-svc`, `auth-svc`,
`fleet-svc`, `convoy-svc`, `alerts-svc`, `guardian-svc`, `media-svc`,
`notification-svc` and `reports-svc` — which now share one implementation
matching `backend/src/utils/orgScopedDb.js`. (`analytics-svc` and
`telemetry-ingest-svc` have no such helper.) Nothing had called it before,
so this changes no existing behaviour; it means the next caller gets real
isolation instead of silent cross-tenant access.

## 4. Architectural constraint discovered

`backend/` is CommonJS and **does not depend on `@sonalit/contracts`**,
which is ESM-only. The legacy monolith therefore **cannot import the AI
plane in-process**. The AI plane must live in the v4 TypeScript/ESM world
and be reached over HTTP.

This is a constraint, not a problem: it forces the AI Gateway (§8) to be a
genuine network boundary, which is what §11 (tool security) requires anyway.

## 5. Delivered in this phase

Phase 1 foundation, in `services/ai-copilot-svc/src/ai/`:

| File | Spec | Purpose |
|---|---|---|
| `types.ts` | §3, §4, §60 | Capability and classification vocabulary, `AIModel`, `InferenceAdapter`, typed failures. |
| `registry.ts` | §6 | DB-backed Model Registry, production gate, candidate selection. |
| `router.ts` | §7, §49, §58 | Capability routing, per-model health, fallback chain. |
| `adapters/anthropic.ts` | §3 | Anthropic Messages API translation. |
| `adapters/openai-compatible.ts` | §5 | vLLM / Ollama / TGI / llama.cpp / Groq — the self-hosting path. |
| `audit.ts` | §44, §59 | Per-request audit rows under tenant RLS. |

Schema: `ai_models` and `ai_audit_log` in `src/db/migrate.ts`.
Tests: 16 unit tests covering classification enforcement, the production
gate, priority ordering, fallback, per-model health isolation, and the
no-fabrication failure mode.

### The property that matters

Adding a self-hosted open-weight model is an `ai_models` **INSERT**:

```sql
INSERT INTO ai_models (name, version, provider, provider_model, capabilities,
  license, license_is_open_source, self_hosted, context_length, endpoint,
  max_data_classification, supports_tools, routing_priority, status,
  approved_for_production)
VALUES ('qwen3-32b', '1', 'openai_compatible', 'Qwen/Qwen3-32B',
  ARRAY['fast_command','general','multilingual'],
  'Apache-2.0', TRUE, TRUE, 32768, 'http://vllm.internal:8000/v1',
  'restricted', TRUE, 5, 'canary', TRUE);
```

No code change, no redeploy of the service. Because `routing_priority` is
5 (below the seeded Anthropic rows at 10 and 20), that model is tried
first and the hosted models become its fallback. `max_data_classification`
of `restricted` lets the most sensitive traffic route to it *exclusively*,
since no hosted row clears above `operational`.

### Tool Registry (§10–12, §42)

`services/ai-copilot-svc/src/tools/`. Four tenant-scoped read tools ported
from the legacy dispatch loop: `query_vehicles`, `query_convoys`,
`query_alerts`, `query_risk_zones`.

Three properties are structural, not per-author discipline:

- **Arguments are validated** against a Zod schema before any handler runs.
  The same schema is converted to the model's JSON Schema, so the two
  cannot drift.
- **Execution is org-scoped.** A handler is *handed* a client already
  inside the caller's RLS context and has no route to an unscoped pool —
  which is why F1 cannot recur here even if a handler's SQL omits a filter.
- **Role filtering happens before the model is told a tool exists**, so an
  unauthorised tool cannot be attempted and does not leak via a refusal.

Not yet ported: the external-API tools (`get_weather`, `check_holidays`,
`get_road_conditions`) and the two mutating tools (`create_geofence`,
`create_risk_zone`). The mutations are §42 Level 1/2 and need the
draft/approval pipeline and idempotency keys (§43) before they move.

### Knowledge Fabric — RAG (§17–19, §34)

`services/ai-copilot-svc/src/rag/`. Schema: `ai_documents` and
`ai_document_chunks`, both org-scoped under RLS, with pgvector.

- **Permissions precede context.** Role, classification and temporal
  validity are clauses *inside* the retrieval SQL, never a filter over its
  results — §18 forbids retrieving broadly and asking the model to ignore
  what it shouldn't see.
- **Hybrid retrieval** (§34): vector similarity fused with full-text by
  reciprocal rank, because embeddings match exact identifiers — a plate, a
  booking reference — poorly, and those are what operators type.
- **Temporal** (§19): expired and superseded documents are excluded unless
  history is asked for explicitly, so a rescinded SOP is not cited as
  current.
- **Embedding-space safety:** vectors from different models are not
  comparable, so `embedding_model` is a hard filter in every query. Mixing
  them returns noise that looks like a result.
- **Degradation:** with no embedding model, ingestion refuses to store a
  placeholder vector and retrieval raises `KnowledgeUnavailableError`, so
  Commander can say retrieval is unavailable (§62) rather than answer from
  parametric memory.

`docker-compose.dev.yml` now runs `pgvector/pgvector:pg16`; the stock
Postgres image has no pgvector.

**RAG is inert until an inference endpoint exists.** Two open-source,
multilingual, 1024-dimension embedding models (`bge-m3`,
`multilingual-e5-large`, both MIT) are registered as `experimental` and
not approved, so the production gate filters them out. Point
`EMBEDDING_ENDPOINT` at a real server and promote them to activate it.
Not yet built: parsing and OCR (§40) upstream of ingestion, and reranking
(§4.7).

### Watchtower — deterministic core (§28–31)

`services/ai-copilot-svc/src/watchtower/`. Schema: `ai_signals`,
`ai_correlations`, `ai_correlation_signals`, all org-scoped under RLS.

- **Normalisation** flattens NATS subjects and legacy alert rows into one
  signal vocabulary. Nothing is invented: an event with no tenant, no
  parseable producer timestamp, or no correlatable entity is *rejected*,
  not approximated — a guessed entity id would correlate against the wrong
  convoy and yield a confident, wrong finding. `observed_at` and
  `ingested_at` are kept separately because the gap between them is the
  freshness figure §48 needs.
- **Correlation** folds a deviation, an unexpected stop, ETA degradation
  and comms silence into one finding instead of four pages — §64's worked
  example, and a passing test. Every contributing signal is carried
  verbatim (§30: aggregation must not destroy evidence), and signals that
  match no rule are returned rather than dropped, so correlation reduces
  noise without ever swallowing a signal.
- **Deterministic by design.** Rules are data and findings are their
  labels, so the same signals always produce the same result and
  Watchtower keeps working with every model offline (§20, Rule 3). The AI
  layer explains a finding; it never produces one. `interpretation` is
  nullable for exactly that reason.

**Live event ingestion.** `WatchtowerConsumer` subscribes to
`events.panic.>`, `events.alert.>` and `events.geofence.breach.>` on
JetStream. Signals are buffered per tenant and correlated on a timer
rather than per message — correlation needs a window, so the first event
of a situation must wait for corroboration instead of firing alone. A
message is acked only once its signal is durably stored, so a crash
mid-write redelivers rather than drops; an unmappable event is acked and
logged, since redelivering it forever would block the consumer.

Disabled by default (`WATCHTOWER_ENABLED=true` to enable) and started
after the HTTP listener, never allowed to abort startup — verified: with
NATS refused, the service logs the failure and continues serving
Commander, RAG and the tool registry.

Not yet built: anomaly detection (§29), the risk engine,
escalation/notification, and AI interpretation.

### Verification against real infrastructure

Everything above was previously typechecked and unit-tested but had never
executed against a database. It has now been run against a real
PostgreSQL 16 with pgvector: migrations apply, the RLS policies isolate
tenants, and the retrieval SQL — a CTE with reciprocal-rank fusion over
two candidate sets — parses and returns the right rows.

`services/ai-copilot-svc/tests/integration/` makes that repeatable:

```bash
docker compose -f docker-compose.dev.yml up -d postgres
TEST_DATABASE_URL=postgres://sonalit:dev-password@localhost:5432/sonalit \
  pnpm --filter @sonalit/ai-copilot-svc test:integration
```

The suite skips (rather than fails) without `TEST_DATABASE_URL`. It uses
a URL rather than testcontainers, unlike sibling services, because it must
also run in CI images and sandboxes that have Postgres but no Docker.

Three real defects surfaced only once the SQL actually ran — see §3c.

## 3c. Defects found by running the code

**`sonalit_app` did not exist, and had no grants.** `withOrgContext` does
`SET LOCAL ROLE sonalit_app`; the role is created by the legacy backend's
migration `20260527_017_app_role.sql`, which may not have run against the
database this service points at. Without it, every org-scoped operation
fails with `role "sonalit_app" does not exist`. Worse, even where the role
existed, migration 017's grants ran before the `ai_*` tables did — so the
role switch would succeed and every query then fail with `permission
denied`. *Fixed:* the migration now provisions the role idempotently and
grants on its own tables.

**Chunks were keyed by registry-row UUID, not embedding space.**
`ai_document_chunks.embedding_model` stored the `ai_models.model_id`
UUID. Re-registering the same model — a version bump, a re-seed, a
rebuilt database — mints a new UUID, and retrieval filtering on it would
have matched nothing: the index would go **silently dark**, returning
zero results with no error. *Fixed:* adapters now return `provider_model`
(`BAAI/bge-m3`), which is the actual embedding space, and chunks key on
that. Regression-tested by re-registering the model and re-querying.

**Dev mode could not start.** `index.ts` configures a `pino-pretty`
transport under `NODE_ENV=development`, but `pino-pretty` was never a
dependency, so the service died at boot with `unable to determine
transport target`. Pre-existing. *Fixed:* declared as a devDependency.

### Predictive risk (§20–22)

`services/ai-copilot-svc/src/risk/`, exposed as the `assess_convoy_risk`
tool.

A transparent additive model — each factor contributes points, and every
contribution is recorded with its direction, magnitude and recency. Chosen
over something more sophisticated because it is reproducible from
`feature_snapshot` alone, explainable by construction (§22 falls out
rather than needing a separate attribution step), and needs training data
the platform does not yet have.

The honest limitation, encoded rather than glossed: the weights are
engineering judgement, not fitted to outcomes. `calibration_status` is
therefore `uncalibrated` and **`probability` is null** — §21 forbids
exposing a probability from an uncalibrated model, and quoting a
percentage here would be a fabricated statistic. The score is an
*ordering* ("which convoy needs attention first"), which is genuinely
useful; making it a probability means back-testing against historical
incidents first.

Other decisions worth knowing:

- Signals decay on a 30-minute half-life, so a score does not jump when a
  signal crosses an arbitrary age boundary.
- Only the strongest occurrence of each signal type counts — one flapping
  device is one problem, not ten, and summing would let a noisy sensor
  dominate.
- A lone critical panic clears the `critical` band on its own. An operator
  triaging by band must never see a panic press ranked below the top.
- A score of zero carries an explicit warning that nothing was *observed*,
  which is not the same as the convoy being safe (Rule 4).
- Schedule context is a bonus input, not a precondition: if the `convoys`
  table is unreachable the signal-based score is still returned, with the
  gap stated. Failing outright would leave an operator with nothing during
  exactly the kind of partial outage the score exists to help with.

The model produces the number; the LLM's role is to explain it (§20). It
never adjusts the score.

## 6. Not yet built

Phases 2–10 remain: RAG and pgvector, Watchtower, Digital Twin, GEOINT,
the optimizer, Commander, report intelligence, vision/voice, hardening.
The Tool Registry (§10) is next, and its natural source is the nine tools
already working in `backend/src/routes/ai.js`.

## 7. Recommended sequence

1. **Decide the §3 question** (self-hosted vs. provider-neutral-only).
2. **Tool Registry** — lift the nine legacy tools behind typed schemas and
   the §12 output contract. Highest value per unit of work: it makes
   Commander grounded, which is §69's actual bar.
3. **pgvector + RAG**, with permission filtering applied pre-context (§18).
4. **Watchtower**, on the existing NATS/BullMQ event buses.
