/*
 * Vercel's NODE_OPTIONS is evaluated from the repository root during
 * dependency installation. The real compatibility preload lives with the
 * web application, so keep this root-level shim dependency-free and safe.
 */
require('../../apps/web/src/utils/productionRiskIntelligencePatches.cjs');
