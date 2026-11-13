import type maplibregl from 'maplibre-gl';

type LabelStyleLayer = {
  id: string;
  type: string;
  'source-layer'?: string;
  layout?: Record<string, unknown>;
  paint?: Record<string, unknown>;
};

const appliedStyle = new WeakMap<maplibregl.Map, string>();

const PLACE_LABEL = /(country|continent|admin|state|province|region|city|town|village|settlement|place|capital|locality|suburb|neighbou?rhood)/i;
const ROAD_LABEL = /(road|street|motorway|highway|transportation|railway|rail|ferry|route|shield)/i;
const WATER_LABEL = /(water|river|lake|ocean|sea|canal)/i;
const POI_LABEL = /(poi|airport|aeroway|harbou?r|port|landmark|hospital|school|park|attraction)/i;

/**
 * Give vector basemaps a stronger, legible label hierarchy without turning
 * collision avoidance off. Raster basemaps already bake their labels into the
 * tiles; this function intentionally leaves those tiles untouched.
 */
export function enhanceDenseMapLabels(map: maplibregl.Map): void {
  if (map.isStyleLoaded() !== true) return;

  const style = map.getStyle();
  const styleKey = JSON.stringify({
    name: style.name ?? '',
    sources: Object.keys(style.sources ?? {}).sort(),
    layers: (style.layers ?? []).map(layer => [layer.id, layer.type, (layer as unknown as LabelStyleLayer)['source-layer'] ?? '']),
  });
  if (appliedStyle.get(map) === styleKey) return;
  appliedStyle.set(map, styleKey);

  for (const rawLayer of style.layers ?? []) {
    if (rawLayer.type !== 'symbol') continue;

    const layer = rawLayer as unknown as LabelStyleLayer;
    const layout = layer.layout;
    if (!layout || layout['text-field'] == null) continue;

    const descriptor = `${layer.id} ${layer['source-layer'] ?? ''}`;
    const isPlace = PLACE_LABEL.test(descriptor);
    const isRoad = ROAD_LABEL.test(descriptor);
    const isWater = WATER_LABEL.test(descriptor);
    const isPoi = POI_LABEL.test(descriptor);
    const multiplier = isPlace ? 1.2 : isRoad || isWater ? 1.12 : isPoi ? 1.08 : 1;
    if (multiplier === 1) continue;

    const textSize = layout['text-size'];
    if (typeof textSize === 'number') {
      map.setLayoutProperty(layer.id, 'text-size', Math.min(textSize * multiplier, isPlace ? 21 : 17));
    } else if (textSize != null) {
      const maxSize = isPlace ? 21 : 17;
      map.setLayoutProperty(layer.id, 'text-size', ['min', ['*', textSize, multiplier], maxSize] as never);
    }

    const haloWidth = layer.paint?.['text-halo-width'];
    if (typeof haloWidth !== 'number' || haloWidth < 1.4) {
      map.setPaintProperty(layer.id, 'text-halo-width', 1.4);
    }
    if (layer.paint?.['text-halo-color'] == null) {
      map.setPaintProperty(layer.id, 'text-halo-color', '#07111d');
    }
  }
}

/**
 * Keep label emphasis active after every basemap switch, including satellite,
 * hybrid, reconnaissance and provider-fallback styles.
 */
export function bindDenseMapLabels(map: maplibregl.Map): () => void {
  const apply = () => enhanceDenseMapLabels(map);
  map.on('style.load', apply);
  if (map.isStyleLoaded()) apply();
  return () => map.off('style.load', apply);
}
