/*
 * Compatibility shim for the inherited Vercel NODE_OPTIONS preload.
 *
 * The Guardian sub-build runs npm from apps/guardian-convoy, where the configured
 * relative preload path resolves to this file. Keep it side-effect-free and reuse
 * the canonical compatibility module from apps/web.
 */
module.exports = require('../../../../apps/web/src/utils/productionRiskIntelligencePatches.cjs');
