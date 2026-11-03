export { RenderGovernor, createRenderGovernor } from './RenderGovernor.js';
export type { RenderMode, GovernorDiagnostics } from './RenderGovernor.js';

export { EntityRegistry } from './EntityRegistry.js';
export type {
  EntityDomain,
  SpatialEntityDescriptor,
  SelectionContext,
} from './EntityRegistry.js';

export { 
  classifySatelliteLod,
  selectSatellitesForLod,
  satelliteGeoJson,
  DEFAULT_SATELLITE_LOD_BUDGET,
  SATELLITE_LOD_HEIGHTS_M,
  SATELLITE_MODELLED_CAPTION,
} from './SatelliteLod.js';
export type {
  SatelliteGeoJsonPointFeature,
  SatelliteLodBudget,
  SatelliteLodOptions,
  SatelliteLodItem,
  SatelliteLodTier,
} from './SatelliteLod.js';
