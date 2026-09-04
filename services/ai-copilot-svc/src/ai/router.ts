// Model Router (spec §7) and fallback chain (spec §49).
//
// This is the only entry point to inference. Callers name a capability and
// a data classification; the router picks a model, and on failure walks
// down the candidate list. When the list is exhausted it THROWS — spec §49
// and Rule 4 both forbid degrading into an invented answer, so the caller
// must either surface the failure or fall back to a deterministic
// (non-AI) Sonalit path.
//
// Ordering is by `routing_priority`, which the registry keeps ascending by
// cost/size. That implements §58's "prefer the smallest model capable of
// completing the task correctly" — a small model is tried first, and if it
// errors the chain escalates.
//
// Per-model health is tracked here rather than in the shared circuit
// breaker in lib/circuit-breaker.ts: that breaker is a single global
// counter, so one dead self-hosted endpoint would trip the breaker for
// every model including healthy ones. Isolation per model is the whole
// point of having a fallback chain.

import {
  AllModelsFailedError,
  NoEligibleModelError,
  type AIModel,
  type EmbeddingRequest,
  type EmbeddingResponse,
  type InferenceRequest,
  type InferenceResponse,
} from './types.js';
import { getModels, selectCandidates } from './registry.js';
import { adapterFor } from './adapters/index.js';
import { config } from '../config.js';

const FAILURE_THRESHOLD = 3;
const COOLDOWN_MS = 60_000;
const FAILURE_WINDOW_MS = 120_000;

interface Health {
  failures: number;
  firstFailureAt: number;
  downUntil: number;
}

const health = new Map<string, Health>();

function isAvailable(modelId: string): boolean {
  const h = health.get(modelId);
  if (!h) return true;
  if (h.downUntil === 0) return true;
  if (Date.now() >= h.downUntil) {
    // Cooldown elapsed — let one request through to probe recovery.
    health.delete(modelId);
    return true;
  }
  return false;
}

function recordFailure(modelId: string): void {
  const now = Date.now();
  const h = health.get(modelId);
  if (!h || now - h.firstFailureAt > FAILURE_WINDOW_MS) {
    health.set(modelId, { failures: 1, firstFailureAt: now, downUntil: 0 });
    return;
  }
  h.failures += 1;
  if (h.failures >= FAILURE_THRESHOLD) {
    h.downUntil = now + COOLDOWN_MS;
  }
}

function recordSuccess(modelId: string): void {
  health.delete(modelId);
}

/** Exposed for the AI Control Center (§57) and the health endpoint. */
export function getModelHealth(): Record<string, { available: boolean; failures: number }> {
  const out: Record<string, { available: boolean; failures: number }> = {};
  for (const [modelId, h] of health) {
    out[modelId] = { available: isAvailable(modelId), failures: h.failures };
  }
  return out;
}

/** Test seam — resets health between cases. */
export function resetHealth(): void {
  health.clear();
}

export interface RouteResult<T> {
  result: T;
  /** Every model tried, in order. Feeds the audit record (§44). */
  attempts: { model_id: string; name: string; ok: boolean; error?: string }[];
}

async function candidatesFor(
  req: Pick<InferenceRequest, 'capability' | 'classification'> & { requiresTools?: boolean },
): Promise<AIModel[]> {
  const models = await getModels();
  const candidates = selectCandidates(models, {
    capability: req.capability,
    classification: req.classification,
    ...(req.requiresTools !== undefined ? { requiresTools: req.requiresTools } : {}),
    productionOnly: config.NODE_ENV === 'production',
  });

  if (candidates.length === 0) {
    throw new NoEligibleModelError(
      req.capability,
      `no registered model satisfies classification '${req.classification}'` +
        (req.requiresTools ? ' with tool support' : ''),
    );
  }

  const available = candidates.filter((m) => isAvailable(m.model_id));
  // If every candidate is cooling down, try them anyway rather than fail
  // outright: a stale cooldown is a worse outcome than one wasted call.
  return available.length > 0 ? available : candidates;
}

export async function infer(req: InferenceRequest): Promise<RouteResult<InferenceResponse>> {
  const requiresTools = (req.tools?.length ?? 0) > 0;
  const candidates = await candidatesFor({ ...req, requiresTools });

  const attempts: RouteResult<InferenceResponse>['attempts'] = [];

  for (const model of candidates) {
    // A prompt that overflows this model's window is a routing mismatch,
    // not a failure to hold against the model's health.
    const approxTokens = estimateTokens(req);
    if (approxTokens > model.context_length) {
      attempts.push({
        model_id: model.model_id,
        name: model.name,
        ok: false,
        error: `context ${String(approxTokens)} exceeds window ${String(model.context_length)}`,
      });
      continue;
    }

    try {
      const result = await adapterFor(model.provider).infer(model, req);
      recordSuccess(model.model_id);
      attempts.push({ model_id: model.model_id, name: model.name, ok: true });
      return { result, attempts };
    } catch (err) {
      recordFailure(model.model_id);
      attempts.push({
        model_id: model.model_id,
        name: model.name,
        ok: false,
        error: errorMessage(err),
      });
    }
  }

  throw new AllModelsFailedError(
    req.capability,
    attempts.map((a) => ({ model_id: a.name, error: a.error ?? 'unknown' })),
  );
}

export async function embed(req: EmbeddingRequest): Promise<RouteResult<EmbeddingResponse>> {
  const candidates = await candidatesFor(req);
  const attempts: RouteResult<EmbeddingResponse>['attempts'] = [];

  for (const model of candidates) {
    const adapter = adapterFor(model.provider);
    if (!adapter.embed) {
      attempts.push({
        model_id: model.model_id,
        name: model.name,
        ok: false,
        error: `provider '${model.provider}' has no embedding support`,
      });
      continue;
    }
    try {
      const result = await adapter.embed(model, req);
      recordSuccess(model.model_id);
      attempts.push({ model_id: model.model_id, name: model.name, ok: true });
      return { result, attempts };
    } catch (err) {
      recordFailure(model.model_id);
      attempts.push({
        model_id: model.model_id,
        name: model.name,
        ok: false,
        error: errorMessage(err),
      });
    }
  }

  throw new AllModelsFailedError(
    req.capability,
    attempts.map((a) => ({ model_id: a.name, error: a.error ?? 'unknown' })),
  );
}

/**
 * Rough token estimate used only to skip models whose window is clearly
 * too small. ~4 chars/token is a crude heuristic that under-counts for
 * non-Latin scripts, so it is applied as a guard against obvious
 * overflow — never as a billing or budgeting figure.
 */
function estimateTokens(req: InferenceRequest): number {
  let chars = req.system?.length ?? 0;
  for (const m of req.messages) chars += m.content.length;
  for (const t of req.tools ?? []) chars += JSON.stringify(t).length;
  return Math.ceil(chars / 4) + (req.max_tokens ?? 2048);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
