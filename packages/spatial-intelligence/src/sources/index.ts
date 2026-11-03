export type {
  WorldSignalProvider,
  ProviderQuery,
  ProviderResult,
  ProviderHealth,
  ProviderBudget,
  ProviderQueryBounds,
  ProviderFailureClass,
} from './providerContract.js';

export { DEFAULT_BUDGETS } from './providerContract.js';

export {
  normalizeOpenSkyState,
  normalizeOpenSkyBatch,
  createOpenSkyProvider,
} from './aircraft/openskyAdapter.js';

export type { OpenSkyStateVector } from './aircraft/openskyAdapter.js';
