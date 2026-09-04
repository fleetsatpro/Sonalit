// Model Registry (spec §6).
//
// The invariant: "No unregistered model may process production Sonalit
// data." Every model that serves a request is a row in `ai_models`, and
// in production that row must additionally be approved and status
// 'production' or 'canary'. There is no code path that calls an inference
// endpoint the registry does not know about.
//
// Rows are cached in-process for REGISTRY_TTL_MS. That is a deliberate
// availability tradeoff: a Postgres blip must not take the AI plane down,
// and the registry is read on every inference call. The cost is that
// retiring a model takes up to a minute to propagate to running pods. For
// an emergency pull, `invalidate()` is exposed and the ops runbook uses a
// rolling restart, which is immediate.

import { query } from '../db.js';

import {
  AIModel,
  type ModelCapability,
  type DataClassification,
  classificationPermits,
} from './types.js';

const REGISTRY_TTL_MS = 60_000;

interface CacheEntry {
  models: AIModel[];
  loadedAt: number;
}

let cache: CacheEntry | null = null;

/** Rows the DB returns, before Zod parsing. */
interface ModelRow {
  model_id: string;
  name: string;
  version: string;
  provider: string;
  provider_model: string;
  capabilities: string[];
  license: string;
  license_is_open_source: boolean;
  self_hosted: boolean;
  context_length: number;
  quantization: string | null;
  hardware_profile: string | null;
  endpoint: string | null;
  api_key_env: string | null;
  max_data_classification: string;
  supports_tools: boolean;
  supports_streaming: boolean;
  routing_priority: number;
  benchmark_score: string | number | null;
  status: string;
  approved_for_production: boolean;
}

function parseRow(row: ModelRow): AIModel {
  return AIModel.parse({
    ...row,
    // NUMERIC comes back from pg as a string; Zod expects a number.
    benchmark_score: row.benchmark_score === null ? null : Number(row.benchmark_score),
  });
}

async function load(): Promise<AIModel[]> {
  const rows = await query<ModelRow>(
    `SELECT model_id, name, version, provider, provider_model, capabilities,
            license, license_is_open_source, self_hosted, context_length,
            quantization, hardware_profile, endpoint, api_key_env,
            max_data_classification, supports_tools, supports_streaming,
            routing_priority, benchmark_score, status, approved_for_production
       FROM ai_models
      WHERE status <> 'retired'
      ORDER BY routing_priority ASC`,
  );

  // A malformed row is dropped, not fatal: one bad registry entry must not
  // deny service for every other model. It is logged loudly instead.
  const models: AIModel[] = [];
  for (const row of rows) {
    try {
      models.push(parseRow(row));
    } catch (err) {
      process.stderr.write(
        `ai_models row '${row.name}' failed validation and was skipped: ${String(err)}\n`,
      );
    }
  }
  return models;
}

export async function getModels(): Promise<AIModel[]> {
  if (cache && Date.now() - cache.loadedAt < REGISTRY_TTL_MS) {
    return cache.models;
  }
  try {
    const models = await load();
    cache = { models, loadedAt: Date.now() };
    return models;
  } catch (err) {
    // Serve stale rather than fail closed — a registry read outage should
    // degrade freshness, not availability (Rule 3).
    if (cache) {
      process.stderr.write(`ai_models refresh failed, serving stale registry: ${String(err)}\n`);
      return cache.models;
    }
    throw err;
  }
}

export function invalidate(): void {
  cache = null;
}

export async function getModel(modelId: string): Promise<AIModel | null> {
  const models = await getModels();
  return models.find((m) => m.model_id === modelId) ?? null;
}

export async function getModelByName(name: string, version?: string): Promise<AIModel | null> {
  const models = await getModels();
  return (
    models.find((m) => m.name === name && (version === undefined || m.version === version)) ?? null
  );
}

export interface CandidateFilter {
  capability: ModelCapability;
  classification: DataClassification;
  /** Tools are requested — exclude models that cannot call them. */
  requiresTools?: boolean;
  /**
   * Enforce the production gate. True in prod; tests and the evaluation
   * lab set it false so `experimental` models can be exercised.
   */
  productionOnly: boolean;
}

/**
 * Models eligible to serve a request, best first.
 *
 * Every filter here is a hard constraint, not a preference — a model that
 * fails any of them is not a worse choice, it is a forbidden one. In
 * particular the classification filter is a security boundary (§60): it
 * must be applied here, before a model is ever handed the payload.
 */
export function selectCandidates(models: AIModel[], filter: CandidateFilter): AIModel[] {
  return models
    .filter((m) => m.capabilities.includes(filter.capability))
    .filter((m) => classificationPermits(m.max_data_classification, filter.classification))
    .filter((m) => (filter.requiresTools ? m.supports_tools : true))
    .filter((m) =>
      filter.productionOnly
        ? m.approved_for_production && (m.status === 'production' || m.status === 'canary')
        : m.status !== 'retired',
    )
    .sort((a, b) => a.routing_priority - b.routing_priority);
}
