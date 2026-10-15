import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/sora/700.css';
import '@fontsource/sora/800.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/600.css';
import '@fontsource/ibm-plex-mono/700.css';
import { Activity, AlertTriangle, ArrowLeft, CalendarClock, ChevronDown, CloudSun, Crosshair, Flame, Globe2, LoaderCircle, MapPin, Pause, Play, RefreshCw, Thermometer, Droplets, Wind, Eye, Waves, X, Satellite, CloudRain } from 'lucide-react';
import { fetchLiveEventSimulation, snapSpatialBounds, shouldRetrySpatialRequest } from '../lib/spatialClient.js';
import type { LiveEventSimulationResponse, SpatialWorldEntity } from '../lib/spatialClient.js';
import { FALLBACK_STREET_STYLE, STREET_STYLE } from '../lib/mapStyles.js';
import { buildOfficialWarningAreaCollection, syncOfficialWarningLayers } from '../lib/weatherWarningGeometry.js';
import WeatherFieldCanvas from '../components/weather/WeatherFieldCanvas.js';
import '../styles/weather-studio.css';

type LayerKey = 'weather' | 'earthquakes' | 'volcanoes' | 'natural';
type Viewport = { latitude: number; longitude: number; radiusM: number; bounds: [number, number, number, number] };
type ForecastStep = Record<string, unknown> & { validAt?: string };
type Glyph = 'sun' | 'cloud' | 'rain' | 'snow' | 'fog' | 'storm' | 'quake' | 'volcano' | 'fire' | 'wave' | 'alert';
type MarkerMeta = { label: string; color: string; glyph: Glyph };

const LAYERS: Array<{ id: LayerKey; label: string; icon: typeof CloudSun }> = [
  { id: 'weather', label: 'Weather models', icon: CloudSun },
  { id: 'earthquakes', label: 'Earthquakes', icon: Activity },
  { id: 'volcanoes', label: 'Volcanic activity', icon: Flame },
  { id: 'natural', label: 'Natural events', icon: Waves },
];

function numberAttr(attrs: Record<string, unknown> | undefined, keys: string[]): number | null {
  for (const key of keys) {
    const value = attrs?.[key];
    const number = Number(value);
    if (value != null && value !== '' && Number.isFinite(number)) return number;
  }
  return null;
}
function textAttr(attrs: Record<string, unknown> | undefined, keys: string[], fallback = 'Not reported'): string {
  for (const key of keys) {
    const value = attrs?.[key];
    if (value != null && String(value).trim()) return String(value);
  }
  return fallback;
}
function formatValidTime(value?: string | null): string {
  if (!value || !Number.isFinite(Date.parse(value))) return 'VALID TIME UNAVAILABLE';
  const date = new Date(value!);
  const month = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'][date.getUTCMonth()];
  return String(date.getUTCDate()).padStart(2, '0') + ' ' + month + ' ' + date.toISOString().slice(11, 16) + ' UTC';
}
function metaFor(entity: SpatialWorldEntity): MarkerMeta {
  const type = String(entity.entityType || '').toLowerCase();
  const attrs = entity.attributes ?? {};
  if (type === 'weather') {
    const code = Number(attrs.weatherCode);
    if (Number.isFinite(code) && code >= 95) return { label: 'THUNDERSTORM', color: '#ff897d', glyph: 'storm' };
    if (Number.isFinite(code) && ((code >= 71 && code <= 77) || code === 85 || code === 86)) return { label: 'SNOW / SLEET', color: '#93d8f1', glyph: 'snow' };
    if (Number.isFinite(code) && (code === 45 || code === 48)) return { label: 'FOG', color: '#b5c5d1', glyph: 'fog' };
    if (Number.isFinite(code) && ((code >= 51 && code <= 67) || (code >= 80 && code <= 82))) return { label: 'RAIN / SHOWERS', color: '#7cbcff', glyph: 'rain' };
    if (Number.isFinite(code) && (code === 0 || code === 1)) return { label: 'CLEAR / MOSTLY CLEAR', color: '#f3cb78', glyph: 'sun' };
    // If a provider omits its numeric code, keep the icon/color consistent
    // with its descriptive condition instead of labelling rain as cloud.
    const description = textAttr(attrs, ['conditions', 'condition', 'description'], 'CLOUD COVER');
    const normalized = description.toLowerCase();
    if (/(thunder|lightning|storm)/.test(normalized)) return { label: description.toUpperCase(), color: '#ff897d', glyph: 'storm' };
    if (/(snow|sleet|freezing rain)/.test(normalized)) return { label: description.toUpperCase(), color: '#93d8f1', glyph: 'snow' };
    if (/(drizzle|rain|shower|precipitation)/.test(normalized)) return { label: description.toUpperCase(), color: '#7cbcff', glyph: 'rain' };
    if (/(fog|mist|haze)/.test(normalized)) return { label: description.toUpperCase(), color: '#b5c5d1', glyph: 'fog' };
    if (/(clear|sunny|fair)/.test(normalized)) return { label: description.toUpperCase(), color: '#f3cb78', glyph: 'sun' };
    return { label: description.toUpperCase(), color: '#a7d9d2', glyph: 'cloud' };
  }
  if (type === 'earthquake') return { label: 'EARTHQUAKE', color: '#ff9a78', glyph: 'quake' };
  if (type === 'volcano' || type === 'volcanic_activity') return { label: 'VOLCANIC ACTIVITY', color: '#e8a16b', glyph: 'volcano' };
  const category = textAttr(attrs, ['categoryTitle', 'categoryId', 'title', 'name'], 'NATURAL EVENT').toLowerCase();
  if (category.includes('fire')) return { label: 'WILDFIRE', color: '#f2a36f', glyph: 'fire' };
  if (category.includes('flood') || category.includes('ocean')) return { label: 'WATER / FLOOD', color: '#80bfff', glyph: 'wave' };
  if (category.includes('storm') || category.includes('cyclone')) return { label: 'STORM SYSTEM', color: '#db9ce8', glyph: 'storm' };
  return { label: textAttr(attrs, ['categoryTitle', 'categoryId'], 'NATURAL EVENT').toUpperCase(), color: '#b1c3d2', glyph: 'alert' };
}
function glyphSvg(glyph: Glyph, color: string): string {
  const attrs = 'fill="none" stroke="' + color + '" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"';
  const paths: Record<Glyph, string> = {
    sun: '<circle cx="12" cy="12" r="4" ' + attrs + '/><path d="M12 2v2.2M12 19.8V22M2 12h2.2M19.8 12H22M4.9 4.9l1.6 1.6M17.5 17.5l1.6 1.6M19.1 4.9l-1.6 1.6M6.5 17.5l-1.6 1.6" ' + attrs + '/>',
    cloud: '<path d="M5 18h12a4 4 0 0 0 .3-8A6 6 0 0 0 6 9a4.5 4.5 0 0 0-1 9Z" ' + attrs + '/>',
    rain: '<path d="M5 15h12a4 4 0 0 0 .3-8A6 6 0 0 0 6 6.5 4.5 4.5 0 0 0 5 15ZM8 18l-1 3M13 18l-1 3M18 18l-1 3" ' + attrs + '/>',
    snow: '<path d="M12 3v18M4 7.5l16 9M4 16.5l16-9M8.5 5l3.5 3.5L15.5 5M8.5 19l3.5-3.5 3.5 3.5" ' + attrs + '/>',
    fog: '<path d="M4 9h16M2.5 13h19M5 17h14M8 5.5h8" ' + attrs + '/>',
    storm: '<path d="M5 14h12a4 4 0 0 0 .3-8A6 6 0 0 0 6 5a4.5 4.5 0 0 0-1 9Z" ' + attrs + '/><path d="m13 13-4 5h3l-1 4 5-7h-3l1-2Z" fill="' + color + '" stroke="none"/>',
    quake: '<path d="M2 13h5l2-5 3.5 10 3.2-8 2.1 3H22" ' + attrs + '/>',
    volcano: '<path d="m3 20 6.8-13 3.1 6 2-3L21 20Z" ' + attrs + '/><path d="M10 3c-1 1.3-.4 2 .5 2.7M15 2c-1 1.3-.7 2.2.1 3" ' + attrs + '/>',
    fire: '<path d="M12 22c5 0 8-4 7-8-.6-2.5-2.5-4.4-4.8-7 .2 2.5-1 4.1-2.1 4.8.4-4.7-2.5-7.8-4.4-9.9.2 5.1-3.5 7.3-3.1 12.1.3 4.4 3.2 8 7.4 8Z" ' + attrs + '/>',
    wave: '<path d="M2 8c2.5-3 4.5 3 7 0s4.5 3 7 0 4.5 3 6 0M2 14c2.5-3 4.5 3 7 0s4.5 3 7 0 4.5 3 6 0M2 20c2.5-3 4.5 3 7 0s4.5 3 7 0 4.5 3 6 0" ' + attrs + '/>',
    alert: '<circle cx="12" cy="12" r="8.5" ' + attrs + '/><path d="M12 7v6M12 17h.01" ' + attrs + '/>',
  };
  return '<svg viewBox="0 0 24 24" aria-hidden="true">' + paths[glyph] + '</svg>';
}
function keyOf(entity: SpatialWorldEntity): string { return String(entity.entityType || 'event') + ':' + String(entity.id || ''); }
function freshnessOf(entity: SpatialWorldEntity): string {
  const alert = entity.attributes?.usgsCurrentAlert as Record<string, unknown> | undefined;
  if (alert && String(alert.sourceStatus ?? '') === 'STALE_CACHE_FALLBACK') return 'STALE';
  return String(entity.quality?.freshnessClass ?? 'UNKNOWN').toUpperCase();
}
function safeSourceUrl(value: unknown): string | null {
  try { const url = new URL(String(value ?? '')); return url.protocol === 'https:' ? url.toString() : null; } catch { return null; }
}
function applyMarkerState(button: HTMLButtonElement, entity: SpatialWorldEntity) {
  const meta = metaFor(entity);
  const previousGlyph = button.dataset.glyph;
  const previousColor = button.style.getPropertyValue('--wx-color');
  const freshness = freshnessOf(entity);
  button.dataset.entityType = String(entity.entityType || 'event').toLowerCase();
  button.dataset.freshness = freshness;
  button.dataset.glyph = meta.glyph;
  button.style.setProperty('--wx-color', meta.color);
  button.setAttribute('aria-label', 'Inspect ' + meta.label + ': ' + textAttr(entity.attributes, ['name', 'title', 'place', 'categoryTitle'], entity.id));
  button.title = meta.label + ' · ' + freshness + ' · ' + String(entity.source || 'Source not recorded');
  // Markers stay static. Continuous motion belongs to the sourced vector field,
  // never to decorative pulses or particles attached to individual conditions.
  if (previousGlyph !== meta.glyph || previousColor !== meta.color || !button.querySelector('.wx-marker__icon')) {
    button.innerHTML = '<span class="wx-marker__icon">' + glyphSvg(meta.glyph, meta.color) + '</span>';
  }
}
function makeMarker(entity: SpatialWorldEntity, onSelect: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'wx-marker';
  applyMarkerState(button, entity);
  button.addEventListener('click', event => { event.stopPropagation(); onSelect(); });
  return button;
}


type NasaRasterKey = 'satellite' | 'precipitation';
type NasaRasterState = Record<NasaRasterKey, boolean>;
const NASA_RASTER_PRODUCTS: Array<{
  key: NasaRasterKey; sourceId: string; layerId: string; tiles: string[]; maxzoom: number; attribution: string;
}> = [
  {
    key: 'satellite',
    sourceId: 'sonalit-nasa-modis-aqua-truecolor',
    layerId: 'sonalit-nasa-modis-aqua-truecolor-layer',
    tiles: ['https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Aqua_CorrectedReflectance_TrueColor/default/default/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg'],
    maxzoom: 9,
    attribution: 'NASA Global Imagery Browse Services (GIBS) · MODIS Aqua corrected reflectance true color',
  },
  {
    key: 'precipitation',
    sourceId: 'sonalit-nasa-gpm-imerg-precipitation',
    layerId: 'sonalit-nasa-gpm-imerg-precipitation-layer',
    tiles: ['https://gibs.earthdata.nasa.gov/wmts/epsg3857/all/IMERG_Precipitation_Rate_v7_NRT/default/default/GoogleMapsCompatible_Level9/{z}/{y}/{x}.png'],
    maxzoom: 9,
    attribution: 'NASA GPM IMERG near-real-time satellite-derived precipitation-rate estimate',
  },
];

function syncNasaRasterLayers(map: maplibregl.Map, visible: NasaRasterState) {
  if (!map.isStyleLoaded()) return;
  const firstSymbol = map.getStyle().layers?.find(layer => layer.type === 'symbol')?.id;
  for (const product of NASA_RASTER_PRODUCTS) {
    if (!map.getSource(product.sourceId)) {
      map.addSource(product.sourceId, {
        type: 'raster', tiles: product.tiles, tileSize: 256, maxzoom: product.maxzoom,
        attribution: product.attribution,
      });
    }
    if (!map.getLayer(product.layerId)) {
      map.addLayer({
        id: product.layerId, type: 'raster', source: product.sourceId,
        layout: { visibility: visible[product.key] ? 'visible' : 'none' },
        paint: {
          'raster-opacity': product.key === 'satellite' ? 0.82 : 0.76,
          'raster-fade-duration': 180,
        },
      }, firstSymbol);
    } else {
      map.setLayoutProperty(product.layerId, 'visibility', visible[product.key] ? 'visible' : 'none');
    }
  }
}

export default function WeatherStudio() {
  const navigate = useNavigate();
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markerRefs = useRef(new Map<string, { marker: maplibregl.Marker; element: HTMLButtonElement }>());
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [mapNotice, setMapNotice] = useState<string | null>(null);
  const [mapAttempt, setMapAttempt] = useState(0);
  const [mapProvider, setMapProvider] = useState<'esri' | 'fallback'>('esri');
  const baseStyleRef = useRef<'esri' | 'fallback'>('esri');
  const baseTileFailuresRef = useRef(0);
  const [viewport, setViewport] = useState<Viewport>({ latitude: 0, longitude: 28, radiusM: 100000, bounds: [12, -28, 62, 34] });
  const [queryViewport, setQueryViewport] = useState(viewport);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setQueryViewport(current => {
        const sameBounds = current.bounds.every((value, index) => value === viewport.bounds[index]);
        return current.latitude === viewport.latitude
          && current.longitude === viewport.longitude
          && current.radiusM === viewport.radiusM
          && sameBounds ? current : viewport;
      });
    }, 3500);
    return () => window.clearTimeout(timer);
  }, [viewport]);
  const [stepIndex, setStepIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [flowMotion, setFlowMotion] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [filters, setFilters] = useState<Record<LayerKey, boolean>>({ weather: true, earthquakes: true, volcanoes: true, natural: true });
  const [rasterLayers, setRasterLayers] = useState<NasaRasterState>({ satellite: false, precipitation: false });
  const rasterLayersRef = useRef<NasaRasterState>(rasterLayers);
  const [rasterError, setRasterError] = useState<string | null>(null);
  const [showOfficialWarnings, setShowOfficialWarnings] = useState(true);
  const [warningOverlayError, setWarningOverlayError] = useState<string | null>(null);
  // Keep each query-cache bucket tied to the exact normalized request it represents.
  const roundedBounds = useMemo(() => snapSpatialBounds(queryViewport.bounds), [queryViewport.bounds]);
  const queryCenter = useMemo(() => ({
    latitude: Number(((roundedBounds[1] + roundedBounds[3]) / 2).toFixed(4)),
    longitude: Number(((roundedBounds[0] + roundedBounds[2]) / 2).toFixed(4)),
  }), [roundedBounds]);
  const queryRadiusM = useMemo(() => {
    const latitudeHalfM = (roundedBounds[3] - roundedBounds[1]) * 111320 / 2;
    const longitudeHalfM = (roundedBounds[2] - roundedBounds[0]) * 111320
      * Math.max(0.087, Math.abs(Math.cos(queryCenter.latitude * Math.PI / 180))) / 2;
    return Math.min(250000, Math.max(1000, Math.round(Math.hypot(latitudeHalfM, longitudeHalfM) / 5000) * 5000));
  }, [roundedBounds, queryCenter.latitude]);

  const liveQuery = useQuery<LiveEventSimulationResponse>({
    queryKey: ['weather-studio-live-events', queryCenter.latitude, queryCenter.longitude, queryRadiusM, ...roundedBounds],
    // Fetch the source feed independently of WebGL/cartographic initialisation so warnings remain available if the map fails.
    enabled: true,
    queryFn: ({ signal }) => fetchLiveEventSimulation({ center: queryCenter, radiusM: queryRadiusM, bounds: roundedBounds, signal }),
    staleTime: 45000,
    refetchInterval: 120000,
    refetchOnWindowFocus: false,
    retry: shouldRetrySpatialRequest,
    placeholderData: previousData => previousData,
  });
  const response = liveQuery.data;
  const warningFeed = response?.weatherAlerts;
  const warningAreas = useMemo(() => buildOfficialWarningAreaCollection(warningFeed), [warningFeed]);
  const mappedWarningCount = useMemo(
    () => new Set(warningAreas.features.map(feature => feature.properties.alertId)).size,
    [warningAreas],
  );
  const warningAreasRef = useRef(warningAreas);
  warningAreasRef.current = warningAreas;
  const showOfficialWarningsRef = useRef(showOfficialWarnings);
  showOfficialWarningsRef.current = showOfficialWarnings;
  const rawEntities = response?.data ?? [];
  const weather = useMemo(() => rawEntities.filter(entity => entity.entityType === 'weather'), [rawEntities]);
  const steps = useMemo(() => {
    const first = weather.find(entity => Array.isArray(entity.attributes?.forecastSteps));
    return (first?.attributes?.forecastSteps as ForecastStep[] | undefined) ?? [];
  }, [weather]);

  useEffect(() => { if (stepIndex > Math.max(0, steps.length - 1)) setStepIndex(Math.max(0, steps.length - 1)); }, [stepIndex, steps.length]);
  useEffect(() => {
    if (!playing || steps.length < 2) return;
    const timer = window.setInterval(() => setStepIndex(value => (value + 1) % steps.length), 2100);
    return () => window.clearInterval(timer);
  }, [playing, steps.length]);

  const renderEntities = useMemo(() => {
    const weatherAtStep = weather.map(entity => {
      const forecastSteps = entity.attributes?.forecastSteps as ForecastStep[] | undefined;
      const selectedStep = forecastSteps?.[Math.min(stepIndex, Math.max(0, (forecastSteps?.length ?? 1) - 1))];
      return selectedStep ? ({ ...entity, attributes: { ...entity.attributes, ...selectedStep, simulationMode: 'hourly_forecast' } } as SpatialWorldEntity) : entity;
    });
    const events = rawEntities.filter(entity => ['earthquake', 'volcano', 'volcanic_activity', 'natural_event'].includes(String(entity.entityType)));
    return [...weatherAtStep, ...events].filter(entity => {
      switch (entity.entityType) {
        case 'weather': return filters.weather;
        case 'earthquake': return filters.earthquakes;
        case 'volcano': case 'volcanic_activity': return filters.volcanoes;
        case 'natural_event': return filters.natural;
        default: return false;
      }
    }).filter(entity => Number.isFinite(entity.latitude) && Number.isFinite(entity.longitude) && entity.latitude >= -90 && entity.latitude <= 90 && entity.longitude >= -180 && entity.longitude <= 180);
  }, [weather, rawEntities, stepIndex, filters]);

  const allEntities = useMemo(() => {
    const weatherAtStep = weather.map(entity => {
      const forecastSteps = entity.attributes?.forecastSteps as ForecastStep[] | undefined;
      const selectedStep = forecastSteps?.[Math.min(stepIndex, Math.max(0, (forecastSteps?.length ?? 1) - 1))];
      return selectedStep ? ({ ...entity, attributes: { ...entity.attributes, ...selectedStep, simulationMode: 'hourly_forecast' } } as SpatialWorldEntity) : entity;
    });
    return [...weatherAtStep, ...rawEntities.filter(entity => entity.entityType !== 'weather')];
  }, [weather, rawEntities, stepIndex]);
  const selectedEntity = allEntities.find(entity => keyOf(entity) === selectedKey) ?? null;
  const selectedForecastTime = steps[Math.min(stepIndex, Math.max(0, steps.length - 1))]?.validAt;
  const weatherCount = weather.length;
  const windVectorCount = weather.filter(entity => numberAttr(entity.attributes, ['windSpeedKmh', 'windSpeed', 'wind_kmh']) != null && numberAttr(entity.attributes, ['windDirectionDeg', 'windDirection', 'wind_direction']) != null).length;
  const earthquakeCount = rawEntities.filter(entity => entity.entityType === 'earthquake').length;
  const volcanoCount = rawEntities.filter(entity => entity.entityType === 'volcano' || entity.entityType === 'volcanic_activity').length;
  const naturalCount = rawEntities.filter(entity => entity.entityType === 'natural_event').length;
  const sourceMeta = response?.health?.weather ?? {};
  const sourceName = String(sourceMeta.source ?? 'Weather provider');
  const normalizedSourceName = sourceName.toLowerCase();
  const fallbackWeatherUrl = normalizedSourceName.includes('open-meteo')
    ? 'https://open-meteo.com/en/docs'
    : normalizedSourceName.includes('met.no') || normalizedSourceName.includes('met norway') || normalizedSourceName === 'met-no'
      ? 'https://api.met.no/weatherapi/locationforecast/2.0/documentation'
      : null;
  const sourceUrl = safeSourceUrl(response?.sources?.weather) ?? fallbackWeatherUrl;
  const requestStatus = (liveQuery.error as { response?: { status?: number } } | null)?.response?.status;
  const isRateLimited = requestStatus === 429;
  const status = (!response && liveQuery.isError) || response?.health?.status === 'UNAVAILABLE' ? 'degraded'
    : liveQuery.isFetching || !response ? 'syncing'
      : response.health?.status === 'PARTIAL' ? 'partial' : liveQuery.isError ? 'partial' : 'available';
  const attrs = selectedEntity?.attributes ?? {};
  const detailSource = selectedEntity
    ? safeSourceUrl(selectedEntity.sourceReference)
      ?? safeSourceUrl(attrs.detailUrl)
      ?? safeSourceUrl(attrs.detailApiUrl)
      ?? safeSourceUrl(attrs.sourceUrl)
      ?? (selectedEntity.entityType === 'weather' ? sourceUrl : null)
    : null;
  const detailTime = selectedEntity?.observedAt ?? (typeof attrs.validAt === 'string' ? attrs.validAt : null);

  useEffect(() => {
    const container = mapContainerRef.current;
    if (!container) return;
    let mounted = true;
    let styleLoaded = false;
    let map: maplibregl.Map | null = null;
    let loadTimer: number | null = null;
    let observer: ResizeObserver | null = null;
    let mapCanvas: HTMLCanvasElement | null = null;
    let contextLostHandler: ((event: Event) => void) | null = null;
    let contextRestoredHandler: (() => void) | null = null;

    setMapReady(false);
    setMapError(null);
    setMapNotice(null);
    setRasterError(null);
    setMapProvider('esri');
    baseStyleRef.current = 'esri';
    baseTileFailuresRef.current = 0;

    // Some package entry points expose Map as the default namespace but do not
    // expose the static supported() helper. Use it only when present; otherwise
    // let the constructor perform actual context creation and catch its failure.
    const rendererSupportCheck = (maplibregl as unknown as { supported?: () => boolean }).supported;
    if (typeof rendererSupportCheck === 'function' && !rendererSupportCheck.call(maplibregl)) {
      setMapError('This browser or graphics environment cannot start the accelerated map renderer. Enable hardware acceleration or retry in a browser with WebGL support.');
      return () => { mounted = false; };
    }

    const syncViewport = (instance: maplibregl.Map) => {
      const center = instance.getCenter();
      const bounds = instance.getBounds();
      let west = bounds.getWest(), east = bounds.getEast();
      if (west >= east) { west = -180; east = 180; }
      const south = Math.max(-90, bounds.getSouth()), north = Math.min(90, bounds.getNorth());
      const latitudeDelta = Math.max(0, north - south) * 111320 / 2;
      const longitudeDelta = Math.max(0, east - west) * 111320 * Math.max(.087, Math.abs(Math.cos(center.lat * Math.PI / 180))) / 2;
      const radiusM = Math.min(250000, Math.max(10000, Math.hypot(latitudeDelta, longitudeDelta) * 1.2));
      setViewport({ latitude: center.lat, longitude: center.lng, radiusM, bounds: [Math.max(-180, west), south, Math.min(180, east), north] });
    };

    try {
      map = new maplibregl.Map({
        container, style: STREET_STYLE, center: [28, 0], zoom: 2.15,
        minZoom: 1.15, maxZoom: 14, attributionControl: true,
        renderWorldCopies: false, cooperativeGestures: true,
        canvasContextAttributes: { antialias: false, powerPreference: 'high-performance', failIfMajorPerformanceCaveat: false },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown renderer initialisation error.';
      setMapError('Map renderer could not initialise. ' + message);
      return () => { mounted = false; };
    }
    mapRef.current = map;
    const instance = map;
    const switchToFallback = () => {
      if (!mounted || baseStyleRef.current === 'fallback') return;
      baseStyleRef.current = 'fallback';
      baseTileFailuresRef.current = 0;
      setMapProvider('fallback');
      setMapNotice('The primary map tile source failed. Switched to an independent cartographic provider.');
      try { instance.setStyle(FALLBACK_STREET_STYLE); }
      catch (_) {
        setMapReady(false);
        setMapError('The primary base map failed and the fallback could not be selected. Retry the map when connectivity is restored.');
      }
    };

    instance.on('style.load', () => {
      if (!mounted) return;
      styleLoaded = true;
      if (loadTimer !== null) { window.clearTimeout(loadTimer); loadTimer = null; }
      baseTileFailuresRef.current = 0;
      setMapProvider(baseStyleRef.current);
      try { syncNasaRasterLayers(instance, rasterLayersRef.current); setRasterError(null); }
      catch (_) { setRasterError('Earth-observation layers could not initialise; base cartography remains available.'); }
      try {
        syncOfficialWarningLayers(instance, warningAreasRef.current, showOfficialWarningsRef.current);
        setWarningOverlayError(null);
      } catch (_) {
        setWarningOverlayError('Verified official warning boundaries could not be drawn. Warning messages remain available from the source feed.');
      }
      setMapError(null);
      setMapNotice(baseStyleRef.current === 'fallback' ? 'Using independent fallback cartography.' : null);
      setMapReady(true);
      syncViewport(instance);
      window.setTimeout(() => { if (mounted) instance.resize(); }, 0);
    });

    instance.on('error', event => {
      if (!mounted) return;
      const sourceId = String((event as unknown as { sourceId?: string }).sourceId ?? '');
      const message = event.error?.message ?? 'Map resources could not be loaded.';
      if (sourceId.startsWith('sonalit-nasa-') || /gibs\.earthdata\.nasa\.gov/i.test(message)) {
        setRasterError('An Earth-observation tile request failed; this overlay may have incomplete coverage.');
        return;
      }
      const isPrimaryTiles = sourceId === 'street' || /World_Street_Map\/MapServer\/tile/i.test(message);
      const isFallbackTiles = sourceId === 'fallback-base' || /basemaps\.cartocdn\.com\/dark_all/i.test(message);
      if (isPrimaryTiles && baseStyleRef.current === 'esri') {
        baseTileFailuresRef.current += 1;
        if (baseTileFailuresRef.current >= 3) switchToFallback();
        return;
      }
      if (isFallbackTiles && baseStyleRef.current === 'fallback') {
        baseTileFailuresRef.current += 1;
        if (baseTileFailuresRef.current >= 3) {
          setMapReady(false);
          setMapNotice(null);
          setMapError('Both primary and fallback base-map tile sources are failing. Check network access, then retry. Weather/event data and source records remain separate from the map renderer.');
        }
        return;
      }
      if (!styleLoaded && /webgl|gpu|context|renderer|style/i.test(message)) {
        setMapReady(false);
        setMapError('The map renderer failed before the base style loaded. Retry to reinitialise the renderer.');
      }
    });

    mapCanvas = instance.getCanvas();
    contextLostHandler = (event: Event) => {
      event.preventDefault();
      if (!mounted) return;
      setMapReady(false);
      setMapError('The browser lost the map graphics context, commonly when GPU resources are exhausted. Retry to create a fresh map instance.');
    };
    contextRestoredHandler = () => {
      if (!mounted || !instance.isStyleLoaded()) return;
      setMapError(null);
      setMapReady(true);
      instance.resize();
    };
    mapCanvas.addEventListener('webglcontextlost', contextLostHandler);
    mapCanvas.addEventListener('webglcontextrestored', contextRestoredHandler);
    instance.on('moveend', () => syncViewport(instance));
    observer = new ResizeObserver(() => instance.resize());
    observer.observe(container);
    loadTimer = window.setTimeout(() => {
      if (!mounted || styleLoaded) return;
      setMapReady(false);
      setMapError('The base map style did not initialise in 12 seconds. This is a renderer/source timeout, not proof that weather conditions are clear.');
    }, 12000);

    return () => {
      mounted = false;
      if (loadTimer !== null) window.clearTimeout(loadTimer);
      observer?.disconnect();
      if (mapCanvas && contextLostHandler) mapCanvas.removeEventListener('webglcontextlost', contextLostHandler);
      if (mapCanvas && contextRestoredHandler) mapCanvas.removeEventListener('webglcontextrestored', contextRestoredHandler);
      for (const record of markerRefs.current.values()) record.marker.remove();
      markerRefs.current.clear();
      instance.remove();
      if (mapRef.current === instance) mapRef.current = null;
      setMapReady(false);
    };
  }, [mapAttempt]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || !map.isStyleLoaded()) return;
    try {
      syncOfficialWarningLayers(map, warningAreas, showOfficialWarnings);
      setWarningOverlayError(null);
    } catch (_) {
      setWarningOverlayError('Verified official warning boundaries could not be drawn. Warning messages remain available from the source feed.');
    }
  }, [mapReady, warningAreas, showOfficialWarnings]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    const incoming = new Map<string, SpatialWorldEntity>(renderEntities.map(entity => [keyOf(entity), entity]));
    for (const [key, record] of markerRefs.current) {
      if (!incoming.has(key)) { record.marker.remove(); markerRefs.current.delete(key); }
    }
    for (const [key, entity] of incoming) {
      const existing = markerRefs.current.get(key);
      if (existing) {
        existing.marker.setLngLat([entity.longitude, entity.latitude]);
        applyMarkerState(existing.element, entity);
      } else {
        const element = makeMarker(entity, () => setSelectedKey(key));
        const marker = new maplibregl.Marker({ element, anchor: 'center' }).setLngLat([entity.longitude, entity.latitude]).addTo(map);
        marker.getElement().style.zIndex = entity.entityType === 'weather' ? '30' : '40';
        markerRefs.current.set(key, { marker, element });
      }
    }
  }, [mapReady, renderEntities]);

  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const id = window.setTimeout(() => mapRef.current?.resize(), 50);
    return () => window.clearTimeout(id);
  }, [mapReady]);

  const setLayer = (id: LayerKey) => setFilters(current => ({ ...current, [id]: !current[id] }));
  const toggleRaster = (key: NasaRasterKey) => setRasterLayers(current => {
    const next = { ...current, [key]: !current[key] };
    rasterLayersRef.current = next;
    const map = mapRef.current;
    if (map?.isStyleLoaded()) {
      try { syncNasaRasterLayers(map, next); setRasterError(null); }
      catch (_) { setRasterError('Earth-observation overlay could not be switched on. The base map remains available.'); }
    }
    return next;
  });
  const fitWorld = () => mapRef.current?.flyTo({ center: [15, 12], zoom: 1.7, duration: 900 });
  const focusEastAfrica = () => mapRef.current?.flyTo({ center: [37, 0], zoom: 4.1, duration: 900 });
  const refresh = () => { void liveQuery.refetch(); };
  const retryMap = () => { setMapError(null); setMapNotice(null); setMapAttempt(value => value + 1); };

  return (
    <div className="wx-studio">
      <header className="wx-header">
        <div className="wx-brand-row">
          <button type="button" className="wx-back" onClick={() => void navigate({ to: '/command' })} aria-label="Return to Command Centre" title="Return to Command Centre"><ArrowLeft size={15} /><span>COMMAND</span></button>
          <div className="wx-brand-mark" aria-hidden="true"><Globe2 size={19} /></div>
          <div className="wx-brand-copy"><div className="wx-eyebrow">SONALIT INTELLIGENCE / ENVIRONMENTAL DESK</div><h1>Weather Studio</h1><p>Global forecasts, official warnings and environmental events.</p></div>
        </div>
        <div className="wx-header-meta">
          <div className="wx-coverage-state" data-state={status}><span className="wx-state-dot" /><div><b>{status === 'available' ? 'SOURCES AVAILABLE' : status === 'syncing' ? 'SYNCHRONISING' : status === 'partial' ? 'PARTIAL COVERAGE' : 'DEGRADED COVERAGE'}</b><small>{response?.health?.status ?? (liveQuery.isError ? 'PROVIDER UNAVAILABLE' : 'CONNECTING TO SOURCES')}</small></div></div>
          <button type="button" className="wx-icon-button" onClick={refresh} disabled={liveQuery.isFetching || isRateLimited} aria-label="Refresh weather and event sources" title={isRateLimited ? 'Refresh throttled; the scheduled retry will run automatically' : 'Refresh sources'}>{liveQuery.isFetching ? <LoaderCircle size={15} className="wx-spin" /> : <RefreshCw size={15} />}</button>
        </div>
      </header>

      <div className="wx-toolbar">
        <div className="wx-toolbar-primary">
          <div className="wx-toolbar-label"><span>FORECAST LAYERS</span><small>Environmental signals</small></div>
          <div className="wx-layer-switches" role="group" aria-label="Map event layers">
            {LAYERS.map(layer => { const Icon = layer.icon; const count = layer.id === 'weather' ? weatherCount : layer.id === 'earthquakes' ? earthquakeCount : layer.id === 'volcanoes' ? volcanoCount : naturalCount; return <button key={layer.id} type="button" className="wx-layer-button" data-active={filters[layer.id]} aria-pressed={filters[layer.id]} onClick={() => setLayer(layer.id)}><Icon size={14} /><span>{layer.label}</span><i>{count}</i></button>; })}
          </div>
          <div className="wx-map-presets"><button type="button" onClick={fitWorld}>GLOBAL</button><button type="button" onClick={focusEastAfrica}>E. AFRICA</button><button type="button" onClick={() => mapRef.current?.zoomIn()} aria-label="Zoom in">+</button><button type="button" onClick={() => mapRef.current?.zoomOut()} aria-label="Zoom out">−</button></div>
        </div>
        <div className="wx-toolbar-secondary">
          <span className="wx-secondary-label">MAP PRODUCTS</span>
          <div className="wx-layer-switches wx-motion-switches" role="group" aria-label="Forecast field motion"><button type="button" className="wx-layer-button" data-active={flowMotion} aria-pressed={flowMotion} disabled={windVectorCount < 2} onClick={() => setFlowMotion(value => !value)} title={windVectorCount < 2 ? "Wind flow needs at least two valid forecast wind vectors in the current response." : "Toggle source-derived wind-flow animation; it is model output, not radar."}><Waves size={14} /><span>Wind flow</span><i>{flowMotion ? "ON" : "OFF"}</i></button></div>
          <div className="wx-layer-switches wx-observation-switches" role="group" aria-label="Earth observation products and verified official warning areas">
            <button type="button" className="wx-layer-button" data-active={rasterLayers.satellite} aria-pressed={rasterLayers.satellite} onClick={() => toggleRaster('satellite')} title="NASA MODIS Aqua true-colour satellite imagery; latest available scene, swath gaps are not clear-weather evidence"><Satellite size={14} /><span>Satellite</span></button>
            <button type="button" className="wx-layer-button" data-active={rasterLayers.precipitation} aria-pressed={rasterLayers.precipitation} onClick={() => toggleRaster('precipitation')} title="NASA GPM IMERG v7 near-real-time satellite-derived precipitation-rate estimate; not live ground radar"><CloudRain size={14} /><span>NASA Rain</span></button>
            <button type="button" className="wx-layer-button" data-active={mapReady && showOfficialWarnings && mappedWarningCount > 0} aria-pressed={mapReady && showOfficialWarnings && mappedWarningCount > 0} disabled={!mapReady || mappedWarningCount === 0} onClick={() => setShowOfficialWarnings(value => !value)} title={!mapReady ? 'Map controls are unavailable until the cartographic renderer is ready; official warning messages remain available.' : mappedWarningCount === 0 ? 'No verified active or upcoming KMD CAP warning polygons are available to map.' : 'Toggle only verified active/upcoming KMD CAP warning polygons supplied by the official feed.'}><AlertTriangle size={14} /><span>KMD Alerts</span><i>{mappedWarningCount}</i></button>
          </div>
        </div>
      </div>

      <main className="wx-workspace">
        <section className="wx-map-panel" aria-label="Interactive weather and natural event map">
          <div className="wx-map-context"><div><div className="wx-map-heading-line"><span className="wx-map-kicker">FORECAST INTELLIGENCE</span><span className="wx-map-provider" data-provider={mapProvider}><i />{mapProvider === "fallback" ? "RESILIENT BASE" : "ESRI CARTOGRAPHY"}</span></div><b>Global atmospheric field</b><small>Modelled wind flow · satellite-derived rainfall estimates · no radar imagery.</small></div><div className="wx-map-utc"><small>FORECAST VALID TIME</small><b>{formatValidTime(selectedForecastTime)}</b></div></div>
          <div className="wx-map-canvas">
            <div className="wx-map-instance" ref={mapContainerRef} />
            <WeatherFieldCanvas
              map={mapReady ? mapRef.current : null}
              entities={renderEntities.filter(entity => entity.entityType === 'weather')}
              active={mapReady && filters.weather && flowMotion}
            />
            {mapReady && filters.weather && flowMotion && windVectorCount >= 2 && (
              <div className="wx-field-label" aria-label="Interpolated numerical forecast wind flow">
                <span aria-hidden="true" /> WIND FLOW <small>MODEL-DERIVED · FORECAST GRID</small>
              </div>
            )}
          {(rasterLayers.satellite || rasterLayers.precipitation) && <div className="wx-observation-note" role="status">
            {rasterLayers.satellite && <span>NASA MODIS Aqua · latest available scene</span>}
            {rasterLayers.precipitation && <span>NASA GPM IMERG · near-real-time precipitation estimate</span>}
            <small>Earth-observation products have acquisition and processing latency. Missing pixels, swaths or coverage gaps do not indicate clear conditions.</small>
          </div>}
          {rasterError && <div className="wx-map-notice wx-raster-notice" role="status"><AlertTriangle size={14} /> {rasterError}</div>}
          </div>
          {!mapReady && !mapError && <div className="wx-map-loading"><LoaderCircle size={18} className="wx-spin" /><span>Initialising map renderer</span></div>}
          {mapReady && mapNotice && <div className="wx-map-notice wx-map-notice--info" role="status"><Globe2 size={14} /> {mapNotice}</div>}
          {!mapReady && mapError && <div className="wx-map-failure" role="alert"><AlertTriangle size={18} /><span className="wx-map-failure__eyebrow">CARTOGRAPHY STATUS</span><b>Map unavailable</b><span>{mapError}</span><button type="button" onClick={retryMap}><RefreshCw size={14} /> RETRY MAP INITIALISATION</button></div>}
          {mapReady && liveQuery.isError && <div className="wx-map-notice" role="status"><AlertTriangle size={14} /> {isRateLimited ? 'Weather refresh is throttled. The last successful snapshot is retained; the next scheduled refresh will retry.' : response ? 'The latest refresh failed. The last successful snapshot is retained; current-area coverage may be partial.' : 'Source request failed. Coverage is unknown; wait before retrying.'}</div>}
          <div className="wx-map-legend" aria-label="Map condition and event legend"><strong>MAP KEY</strong><span><i style={{ background: '#f3cb78' }} /> CLEAR</span><span><i style={{ background: '#7cbcff' }} /> RAIN</span><span><i style={{ background: '#ff897d' }} /> STORM</span><span><i style={{ background: '#93d8f1' }} /> SNOW</span><span><i style={{ background: '#ff9a78' }} /> SEISMIC</span><span><i style={{ background: '#e8a16b' }} /> VOLCANO</span><span><i style={{ background: '#b1c3d2' }} /> NATURAL EVENT</span>{showOfficialWarnings && warningAreas.features.length > 0 && <span><i style={{ background: '#e7a75c', borderRadius: 2 }} /> KMD WARNING AREA</span>}</div>
          <div className="wx-timeline">
            <div className="wx-player-row"><button type="button" className="wx-play-button" onClick={() => setPlaying(value => !value)} disabled={steps.length < 2} aria-label={playing ? 'Pause forecast timeline' : 'Play forecast timeline'} title={playing ? 'Pause forecast timeline' : 'Play forecast timeline'}>{playing ? <Pause size={14} /> : <Play size={14} />}</button><div className="wx-timeline-caption"><small>HOURLY MODEL PLAYBACK</small><b>{formatValidTime(selectedForecastTime)}</b></div><div className="wx-step-count">{steps.length ? String(stepIndex + 1).padStart(2, '0') + ' / ' + String(steps.length).padStart(2, '0') : '— / —'}</div></div>
            <input className="wx-range" type="range" min={0} max={Math.max(0, steps.length - 1)} step={1} value={Math.min(stepIndex, Math.max(0, steps.length - 1))} disabled={steps.length < 2} onChange={event => { setStepIndex(Number(event.target.value)); setPlaying(false); }} aria-label="Select forecast valid time; this is not a measured historical replay" />
            <div className="wx-range-labels"><span>{formatValidTime(steps[0]?.validAt)}</span><span>{formatValidTime(steps[steps.length - 1]?.validAt)}</span></div>
            <div className="wx-timeline-note"><CalendarClock size={12} /> Forecast-valid times, not observed radar frames or historical playback.</div>
          </div>
        </section>

        <aside className="wx-right-column">
          <section className="wx-card wx-warning-card" aria-label="Official weather early-warning feed">
            <div className="wx-card-heading">
              <div><span>01 / OFFICIAL WARNINGS</span><h2>Kenya · Official alerts</h2></div>
              <span className="wx-card-status" data-state={!warningFeed ? 'syncing' : warningFeed.status === 'UNAVAILABLE' ? 'degraded' : warningFeed.status === 'STALE_FALLBACK' ? 'syncing' : warningFeed.status === 'AVAILABLE' ? 'available' : 'partial'}>{!warningFeed ? 'CONNECTING' : warningFeed.status === 'UNAVAILABLE' ? 'UNAVAILABLE' : warningFeed.status === 'STALE_FALLBACK' ? 'STALE CACHE' : warningFeed.status === 'AVAILABLE' ? 'FEED AVAILABLE' : 'STATUS UNKNOWN'}</span>
            </div>
            <p className="wx-warning-scope">Kenya Meteorological Department · Common Alerting Protocol feed. National coverage only.</p>
            {warningOverlayError && <p className="wx-warning-empty" role="status"><AlertTriangle size={14} /> {warningOverlayError}</p>}
            {warningFeed && warningFeed.status !== 'UNAVAILABLE' && warningFeed.alerts.length > 0 && mappedWarningCount === 0 && <p className="wx-warning-empty" role="status">Official notices are present, but none supplies a verified, usable area polygon. No warning boundary has been inferred.</p>}
            {warningFeed?.status === 'UNAVAILABLE' ? (
              <p className="wx-warning-empty" role="status"><AlertTriangle size={14} /> The official feed could not be verified. This is not evidence that no warning exists.</p>
            ) : !warningFeed ? (
              <p className="wx-warning-empty" role="status"><LoaderCircle size={14} className="wx-spin" /> Loading the official warning feed.</p>
            ) : warningFeed.alerts.length === 0 ? (
              <p className="wx-warning-empty" role="status">The feed returned no current entries. This does not certify clear weather or absence of hazards.</p>
            ) : (
              <div className="wx-warning-list">
                {warningFeed.alerts.slice(0, 5).map(alert => (
                  <article className="wx-warning-entry" key={alert.id}>
                    <div className="wx-warning-entry-top">
                      <span className="wx-warning-severity" data-severity={(alert.severity || alert.activeState).toLowerCase()}>{alert.severity || (alert.activeState === 'ACTIVE' ? 'ACTIVE' : alert.activeState === 'UPCOMING' ? 'SCHEDULED' : 'DETAILS IN FEED')}</span>
                      {alert.urgency && <span className="wx-warning-urgency">{alert.urgency}</span>}
                    </div>
                    <h3>{alert.title}</h3>
                    {alert.areas?.length ? <p className="wx-warning-area">{alert.areas.map(area => area.description).filter(Boolean).join(' · ')}</p> : null}
                    {alert.description && <p className="wx-warning-description">{alert.description}</p>}
                    <div className="wx-warning-times">
                      {alert.sentAt && <span>ISSUED {formatValidTime(alert.sentAt)}</span>}
                      {alert.expiresAt && <span>EXPIRES {formatValidTime(alert.expiresAt)}</span>}
                    </div>
                    {alert.url && <a className="wx-source-link" href={alert.url} target="_blank" rel="noreferrer">OPEN OFFICIAL NOTICE <ChevronDown size={12} /></a>}
                  </article>
                ))}
              </div>
            )}
            {warningFeed && warningFeed.alerts.some(alert => !alert.verifiedCap) && <p className="wx-warning-caveat">Some feed entries do not expose structured CAP severity, expiry or area fields. Sonalit leaves those details unclassified rather than guessing.</p>}
            <div className="wx-warning-footer">
              <span>{warningFeed ? warningFeed.activeCount + ' VERIFIED ACTIVE CAP WARNING' + (warningFeed.activeCount === 1 ? '' : 'S') : 'STATUS UNCONFIRMED'}</span>
              <a href="https://meteo.go.ke/api/cap/rss.xml" target="_blank" rel="noreferrer">OPEN KMD FEED <ChevronDown size={11} /></a>
            </div>
          </section>
          <section className="wx-card wx-overview-card"><div className="wx-card-heading"><div><span>02 / SIGNAL SUMMARY</span><h2>Signal summary</h2></div><span className="wx-card-status" data-state={status}>{status.toUpperCase()}</span></div><div className="wx-stat-grid"><div><CloudSun size={14} /><small>MODEL POINTS</small><b>{weatherCount}</b></div><div><Activity size={14} /><small>EARTHQUAKES</small><b>{earthquakeCount}</b></div><div><Flame size={14} /><small>VOLCANO SIGNALS</small><b>{volcanoCount}</b></div><div><Waves size={14} /><small>OPEN EVENTS</small><b>{naturalCount}</b></div></div><div className="wx-health-foot"><span>GENERATED</span><b>{response?.generatedAt ? formatValidTime(response.generatedAt) : 'NOT YET RECEIVED'}</b></div>{response?.warnings?.length ? <div className="wx-warning-list">{response.warnings.slice(0, 3).map((warning, i) => <p key={warning + i}><AlertTriangle size={12} /> {warning.replaceAll('_', ' ')}</p>)}</div> : null}</section>

          <section className="wx-card wx-detail-card"><div className="wx-card-heading"><div><span>03 / SELECTED SIGNAL</span><h2>{selectedEntity ? metaFor(selectedEntity).label : 'Inspect the map'}</h2></div>{selectedEntity && <button type="button" className="wx-clear-selection" onClick={() => setSelectedKey(null)} aria-label="Clear selected signal"><X size={13} /></button>}</div>
            {selectedEntity ? <div className="wx-detail-body"><div className="wx-detail-title">{textAttr(attrs, ['name', 'title', 'place', 'categoryTitle'], selectedEntity.entityType === 'weather' ? 'Forecast grid point' : selectedEntity.id)}</div><div className="wx-detail-subtitle">{String(selectedEntity.entityType).replaceAll('_', ' ').toUpperCase()} · {freshnessOf(selectedEntity)}</div>
              {selectedEntity.entityType === 'weather' ? <div className="wx-metric-grid"><div><Thermometer size={13} /><small>TEMPERATURE</small><b>{numberAttr(attrs, ['temperatureC', 'temperature', 'tempC', 'temp_c']) != null ? numberAttr(attrs, ['temperatureC', 'temperature', 'tempC', 'temp_c']) + '°C' : '—'}</b></div><div><Droplets size={13} /><small>PRECIPITATION</small><b>{numberAttr(attrs, ['precipitationMm', 'precipitation', 'precip_mm']) != null ? numberAttr(attrs, ['precipitationMm', 'precipitation', 'precip_mm']) + ' mm' : '—'}</b></div><div><Wind size={13} /><small>WIND</small><b>{numberAttr(attrs, ['windSpeedKmh', 'windSpeed', 'wind_kmh']) != null ? numberAttr(attrs, ['windSpeedKmh', 'windSpeed', 'wind_kmh']) + ' km/h' : '—'}</b></div><div><Eye size={13} /><small>VISIBILITY</small><b>{numberAttr(attrs, ['visibilityKm', 'visibility', 'visibility_km']) != null ? numberAttr(attrs, ['visibilityKm', 'visibility', 'visibility_km']) + ' km' : '—'}</b></div></div> : <div className="wx-event-facts">{selectedEntity.entityType === 'earthquake' && <p><b>MAGNITUDE</b><span>{numberAttr(attrs, ['magnitude']) != null ? 'M' + numberAttr(attrs, ['magnitude']) : 'Not recorded'}</span></p>}{(selectedEntity.entityType === 'volcano' || selectedEntity.entityType === 'volcanic_activity') && <p><b>REPORT / ALERT</b><span>{textAttr(attrs, ['reportType', 'alertLevel', 'colorCode'], 'See official source')}</span></p>}<p><b>LOCATION</b><span>{Number(selectedEntity.latitude).toFixed(3)}°, {Number(selectedEntity.longitude).toFixed(3)}°</span></p><p><b>EVENT TIME</b><span>{detailTime ? formatValidTime(detailTime) : 'Not supplied by source'}</span></p></div>}
              <div className="wx-provenance"><div><small>SOURCE</small><b>{selectedEntity.source || 'Source identifier not supplied'}</b></div><div><small>OBSERVED / VALID</small><b>{detailTime ? formatValidTime(detailTime) : 'Timestamp not supplied'}</b></div><div><small>POSITION</small><b>{Number(selectedEntity.latitude).toFixed(4)}°, {Number(selectedEntity.longitude).toFixed(4)}°</b></div></div>{detailSource && <a className="wx-source-link" href={detailSource} target="_blank" rel="noreferrer">{selectedEntity?.entityType === 'weather' ? 'SOURCE METHODOLOGY' : 'OPEN SOURCE RECORD'} <ChevronDown size={12} /></a>}{selectedEntity.entityType === 'weather' && <p className="wx-semantic-note">Numerical forecast at a provider model-grid coordinate. Marker motion illustrates the selected condition—not a radar return, precipitation footprint, or storm boundary.</p>}</div> : <div className="wx-empty-detail"><Crosshair size={22} /><p>Select a weather point or natural-event marker to inspect values, timing, source and freshness.</p></div>}
          </section>



          <details className="wx-card wx-source-card" aria-label="Source integrity and data lineage"><summary className="wx-card-heading wx-source-summary"><div><span>04 / DATA LINEAGE</span><h2>Source integrity</h2></div><span className="wx-source-expand-label">View sources</span><ChevronDown size={15} className="wx-source-chevron" /></summary><div className="wx-source-row"><span>WEATHER MODEL</span>{sourceUrl ? <a href={sourceUrl} target="_blank" rel="noreferrer">{sourceName}</a> : <b>{sourceName}</b>}</div><div className="wx-source-row"><span>EARTHQUAKES</span><b>USGS ComCat</b></div><div className="wx-source-row"><span>VOLCANO ALERTS / REPORTS</span><b>USGS · Smithsonian GVP</b></div><div className="wx-source-row"><span>OPEN NATURAL EVENTS</span><b>NASA EONET</b></div>
          <div className="wx-source-row"><span>SATELLITE IMAGERY</span><a href="https://nasa-gibs.github.io/gibs-api-docs/" target="_blank" rel="noreferrer">NASA GIBS / MODIS Aqua</a></div>
          <div className="wx-source-row"><span>PRECIPITATION ESTIMATE</span><a href="https://gpm.nasa.gov/data/imerg" target="_blank" rel="noreferrer">NASA GPM IMERG v7 NRT</a></div>
          <div className="wx-source-row"><span>OFFICIAL WARNINGS</span><a href="https://alertingauthority.wmo.int/authorities.php?recId=80" target="_blank" rel="noreferrer">KMD CAP · WMO register</a></div>
          <p className="wx-source-disclaimer">Source status and timestamps are retained wherever supplied. Missing or degraded coverage is not proof of clear weather or no hazard. Numerical forecasts are modelled; NASA GPM IMERG is a satellite-derived precipitation estimate with processing latency, not live ground radar. Earthquake symbols locate catalogue epicentres only.</p></details>
        </aside>
      </main>
      <footer className="wx-footer"><span>SONALIT / WEATHER INTELLIGENCE</span><span>MODEL-LED FORECASTS · SOURCE-ATTRIBUTED EVENTS · NO FABRICATED HAZARD GEOMETRY</span><button type="button" onClick={() => void navigate({ to: '/gev' })}>OPEN GOD’S EYE VIEW <MapPin size={12} /></button></footer>
    </div>
  );
}
