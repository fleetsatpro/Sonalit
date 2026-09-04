// Provider-neutral AI model fabric — the type layer.
//
// The rule this file exists to enforce (spec §3): Sonalit business logic
// asks for a CAPABILITY ("reasoning", "fast_command"), never a provider or
// a model id. Nothing outside src/ai/ should ever contain the string
// "claude-…" or "llama-…". That indirection is what makes a model
// swappable — including swapping a hosted API for a self-hosted open-weight
// endpoint — without touching a single caller.
//
// Contrast with what this replaces: routes/ai.ts pinned `const MODEL =
// 'claude-sonnet-4-6'` and backend/src/routes/ai.js pinned
// 'claude-opus-4-7'. Changing either meant editing route code.

import { z } from 'zod';

/**
 * What a model is FOR, not what it is. Callers select on this.
 *
 * Deliberately coarse: these are the specialisation roles in spec §4, and
 * the set is small enough that a human can reason about which one a task
 * needs. Adding a capability is a real architectural decision (it implies
 * a new routing policy and new registry rows), not a convenience.
 */
export const ModelCapability = z.enum([
  'fast_command', // §4.1 classification, intent, extraction. latency > depth
  'general', // §4.2 operational conversation, multi-step tool use
  'reasoning', // §4.3 investigation, tradeoffs, planning. expensive — earn it
  'multilingual', // §4.4 EN/FR operational queries
  'vision', // §4.5 documents, container/vehicle imagery
  'embedding', // §4.6 semantic retrieval
  'rerank', // §4.7 post-retrieval reranking
  'speech', // §4.8 speech-to-text
]);
export type ModelCapability = z.infer<typeof ModelCapability>;

/**
 * Sensitivity of the data about to enter a model's context (spec §60).
 *
 * Classification is decided by the CALLER, which knows what it is passing;
 * the router then refuses any model whose policy does not clear it. This is
 * the hook that lets a future deployment send RESTRICTED traffic only to
 * on-premise inference while INTERNAL traffic still uses a hosted API —
 * a registry change, with no code change at the call sites.
 */
export const DataClassification = z.enum([
  'public',
  'internal',
  'operational',
  'sensitive',
  'restricted',
]);
export type DataClassification = z.infer<typeof DataClassification>;

const CLASSIFICATION_RANK: Record<DataClassification, number> = {
  public: 0,
  internal: 1,
  operational: 2,
  sensitive: 3,
  restricted: 4,
};

/** True when a model cleared to `allowed` may process `actual`. */
export function classificationPermits(
  allowed: DataClassification,
  actual: DataClassification,
): boolean {
  return CLASSIFICATION_RANK[actual] <= CLASSIFICATION_RANK[allowed];
}

/**
 * How a model is reached. Both self-hosted and hosted inference are
 * ordinary values here — that symmetry is the point.
 *
 * `openai_compatible` covers vLLM, Ollama, TGI, llama.cpp and Groq alike:
 * they all speak /v1/chat/completions, so a self-hosted open-weight
 * deployment needs a registry row and an endpoint URL, not a new adapter.
 */
export const ModelProvider = z.enum(['anthropic', 'openai_compatible']);
export type ModelProvider = z.infer<typeof ModelProvider>;

export const ModelStatus = z.enum([
  'experimental',
  'evaluation',
  'staging',
  'canary',
  'production',
  'retired',
]);
export type ModelStatus = z.infer<typeof ModelStatus>;

/**
 * A registered model. Mirrors the `ai_models` table 1:1 (spec §6).
 *
 * `license` and `license_is_open_source` are recorded separately on
 * purpose: spec §5 forbids treating "open weight" as "open source", and
 * several open-weight licences (Llama Community, Gemma Terms) carry usage
 * restrictions that legal needs to see explicitly rather than infer.
 */
export const AIModel = z.object({
  /** UUID primary key. Referenced by ai_audit_log.model_id. */
  model_id: z.string().uuid(),
  /** Human-readable identifier, e.g. 'qwen3-32b'. Used in logs and errors. */
  name: z.string().min(1),
  version: z.string().min(1),
  provider: ModelProvider,
  /** Provider-side identifier, e.g. 'claude-sonnet-4-6' or 'Qwen/Qwen3-32B'. */
  provider_model: z.string().min(1),
  capabilities: z.array(ModelCapability).min(1),
  license: z.string().min(1),
  license_is_open_source: z.boolean(),
  self_hosted: z.boolean(),
  context_length: z.number().int().positive(),
  quantization: z.string().nullable(),
  hardware_profile: z.string().nullable(),
  endpoint: z.string().nullable(),
  /** Env var holding the credential. Never the credential itself. */
  api_key_env: z.string().nullable(),
  max_data_classification: DataClassification,
  supports_tools: z.boolean(),
  supports_streaming: z.boolean(),
  /**
   * Router preference within a capability, ascending. Spec §58 wants the
   * SMALLEST model that can do the job correctly, so cheaper/faster models
   * take lower numbers and are tried first.
   */
  routing_priority: z.number().int(),
  benchmark_score: z.number().nullable(),
  status: ModelStatus,
  approved_for_production: z.boolean(),
});
export type AIModel = z.infer<typeof AIModel>;

// ── Inference interface ────────────────────────────────────────────────────
// Deliberately narrower than any one provider's SDK. Adapters translate
// down to it. If a shape here is provider-specific, it is a design bug.

export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON Schema for the tool's arguments. */
  input_schema: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export type InferenceMessage =
  | { role: 'user' | 'assistant'; content: string }
  | { role: 'assistant'; content: string; tool_calls: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

export interface InferenceRequest {
  capability: ModelCapability;
  classification: DataClassification;
  system?: string;
  messages: InferenceMessage[];
  tools?: ToolDefinition[];
  max_tokens?: number;
  temperature?: number;
  /** Hard ceiling per attempt. The router budgets across fallbacks (§52). */
  timeout_ms?: number;
}

export type StopReason = 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence';

export interface InferenceResponse {
  text: string;
  tool_calls: ToolCall[];
  stop_reason: StopReason;
  /** Registry row UUID. Used for the audit log's foreign key. */
  model_id: string;
  /** Human-readable registry name, e.g. 'qwen3-32b'. For logs and errors. */
  model_name: string;
  /**
   * Provider-side identifier, e.g. 'BAAI/bge-m3'. This is the STABLE
   * identity of the model itself, independent of which registry row served
   * it — see EmbeddingResponse for why that distinction matters.
   */
  provider_model: string;
  model_version: string;
  input_tokens: number;
  output_tokens: number;
  latency_ms: number;
}

export interface EmbeddingRequest {
  capability: Extract<ModelCapability, 'embedding'>;
  classification: DataClassification;
  input: string[];
}

export interface EmbeddingResponse {
  vectors: number[][];
  /** Registry row UUID. */
  model_id: string;
  model_name: string;
  /**
   * Provider-side identifier — the embedding SPACE these vectors live in.
   *
   * Stored on every chunk and filtered on at retrieval, because vectors
   * from different models are not comparable. It must be the provider
   * model rather than the registry UUID: re-registering the same model
   * (a version bump, a re-seed, a rebuilt database) mints a new UUID, and
   * keying on that would make every existing chunk unreachable and the
   * index would silently go dark.
   */
  provider_model: string;
  model_version: string;
  input_tokens: number;
  latency_ms: number;
}

/**
 * The contract every provider integration implements. Adding a provider
 * means adding one of these — never touching the router or any caller.
 */
export interface InferenceAdapter {
  readonly provider: ModelProvider;
  infer(model: AIModel, req: InferenceRequest): Promise<InferenceResponse>;
  embed?(model: AIModel, req: EmbeddingRequest): Promise<EmbeddingResponse>;
}

/**
 * Raised when NO registered model could serve a request.
 *
 * This is thrown rather than degraded into a text answer on purpose: spec
 * §49 and Rule 4 forbid fabricating output when models are unavailable.
 * Callers must surface the failure or fall back to a deterministic
 * (non-AI) path — never invent one.
 */
export class NoEligibleModelError extends Error {
  constructor(
    readonly capability: ModelCapability,
    readonly reason: string,
  ) {
    super(`No eligible model for capability '${capability}': ${reason}`);
    this.name = 'NoEligibleModelError';
  }
}

/** Raised when every candidate in the fallback chain failed. */
export class AllModelsFailedError extends Error {
  constructor(
    readonly capability: ModelCapability,
    readonly attempts: { model_id: string; error: string }[],
  ) {
    super(
      `All ${attempts.length} model(s) failed for capability '${capability}': ${ 
        attempts.map((a) => `${a.model_id} (${a.error})`).join('; ')}`,
    );
    this.name = 'AllModelsFailedError';
  }
}
