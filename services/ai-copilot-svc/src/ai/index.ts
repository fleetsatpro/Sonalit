// Public surface of the AI model fabric.
//
// Callers import from here and never reach into adapters/ or name a
// provider: `infer({ capability: 'reasoning', ... })`, not
// `anthropic.messages.create({ model: 'claude-…' })`.
export * from './types.js';
export { infer, embed, getModelHealth, resetHealth, type RouteResult } from './router.js';
export { getModels, getModel, getModelByName, invalidate, selectCandidates } from './registry.js';
export { recordAudit, newRequestId, type AuditRecord, type AuditOutcome } from './audit.js';
