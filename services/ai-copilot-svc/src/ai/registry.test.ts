import { describe, it, expect } from 'vitest';
import { selectCandidates } from './registry.js';
import { classificationPermits, type AIModel } from './types.js';

function model(overrides: Partial<AIModel> = {}): AIModel {
  return {
    model_id: '00000000-0000-4000-8000-000000000001',
    name: 'test-model',
    version: '1',
    provider: 'openai_compatible',
    provider_model: 'test',
    capabilities: ['general'],
    license: 'Apache-2.0',
    license_is_open_source: true,
    self_hosted: true,
    context_length: 32000,
    quantization: null,
    hardware_profile: null,
    endpoint: 'http://vllm:8000/v1',
    api_key_env: null,
    max_data_classification: 'operational',
    supports_tools: true,
    supports_streaming: true,
    routing_priority: 100,
    benchmark_score: null,
    status: 'production',
    approved_for_production: true,
    ...overrides,
  };
}

describe('classificationPermits', () => {
  it('allows data at or below the model’s clearance', () => {
    expect(classificationPermits('sensitive', 'operational')).toBe(true);
    expect(classificationPermits('sensitive', 'sensitive')).toBe(true);
  });

  it('refuses data above the model’s clearance', () => {
    expect(classificationPermits('internal', 'restricted')).toBe(false);
    expect(classificationPermits('operational', 'sensitive')).toBe(false);
  });
});

describe('selectCandidates', () => {
  const base = { classification: 'operational' as const, productionOnly: true };

  it('returns only models holding the requested capability', () => {
    const models = [
      model({ name: 'general-only', capabilities: ['general'] }),
      model({ name: 'reasoner', capabilities: ['reasoning'] }),
    ];
    const got = selectCandidates(models, { ...base, capability: 'reasoning' });
    expect(got.map((m) => m.name)).toEqual(['reasoner']);
  });

  // §60 — the classification filter is a security boundary, so it must be
  // applied at selection time, before any payload reaches an adapter.
  it('excludes models not cleared for the data classification', () => {
    const models = [
      model({ name: 'low-clearance', max_data_classification: 'internal' }),
      model({ name: 'high-clearance', max_data_classification: 'restricted' }),
    ];
    const got = selectCandidates(models, {
      capability: 'general',
      classification: 'restricted',
      productionOnly: true,
    });
    expect(got.map((m) => m.name)).toEqual(['high-clearance']);
  });

  // §6 — "No unregistered model may process production Sonalit data"; the
  // same gate keeps unapproved and non-production rows out of prod traffic.
  it('excludes unapproved and non-production models when productionOnly', () => {
    const models = [
      model({ name: 'experimental', status: 'experimental', approved_for_production: false }),
      model({ name: 'staging', status: 'staging', approved_for_production: true }),
      model({ name: 'canary', status: 'canary', approved_for_production: true }),
      model({ name: 'live', status: 'production', approved_for_production: true }),
    ];
    const got = selectCandidates(models, { ...base, capability: 'general' });
    expect(got.map((m) => m.name).sort()).toEqual(['canary', 'live']);
  });

  it('admits non-production models when the production gate is off', () => {
    const models = [
      model({ name: 'experimental', status: 'experimental', approved_for_production: false }),
      model({ name: 'retired', status: 'retired', approved_for_production: false }),
    ];
    const got = selectCandidates(models, {
      capability: 'general',
      classification: 'operational',
      productionOnly: false,
    });
    expect(got.map((m) => m.name)).toEqual(['experimental']);
  });

  it('excludes models without tool support when tools are required', () => {
    const models = [
      model({ name: 'no-tools', supports_tools: false }),
      model({ name: 'tools', supports_tools: true }),
    ];
    const got = selectCandidates(models, { ...base, capability: 'general', requiresTools: true });
    expect(got.map((m) => m.name)).toEqual(['tools']);
  });

  // §58 — prefer the smallest capable model, so ascending priority first.
  it('orders candidates by ascending routing_priority', () => {
    const models = [
      model({ name: 'big', routing_priority: 90 }),
      model({ name: 'small', routing_priority: 10 }),
      model({ name: 'medium', routing_priority: 50 }),
    ];
    const got = selectCandidates(models, { ...base, capability: 'general' });
    expect(got.map((m) => m.name)).toEqual(['small', 'medium', 'big']);
  });

  it('returns empty rather than a fallback when nothing qualifies', () => {
    const got = selectCandidates([model({ capabilities: ['general'] })], {
      ...base,
      capability: 'speech',
    });
    expect(got).toEqual([]);
  });
});
