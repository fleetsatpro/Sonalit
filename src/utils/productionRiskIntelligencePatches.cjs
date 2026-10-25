/*
 * Vercel build compatibility preload.
 *
 * The connected Vercel environment preloads ./src/utils/productionRiskIntelligencePatches.cjs
 * from the repository root before package installation. The canonical, deliberately
 * side-effect-free frontend preload lives under apps/web; re-export it here so the
 * configured NODE_OPTIONS path resolves consistently from the monorepo root.
 */
module.exports = require('../../apps/web/src/utils/productionRiskIntelligencePatches.cjs');
