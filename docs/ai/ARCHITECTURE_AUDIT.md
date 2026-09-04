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
