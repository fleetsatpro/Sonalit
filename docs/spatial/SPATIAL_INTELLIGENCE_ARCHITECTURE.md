# Sonalit Spatial Intelligence Architecture (Loop 01)

**Authority:** Sonalit operational domain is the sole source of truth.
**Package:** `@sonalit/spatial-intelligence`

## Package layout

```
packages/spatial-intelligence/
  src/
    model/       SpatialObservation, classifyFreshness, buildQuality
    geometry/    distanceM, bboxFromCenterRadius, distanceToPolylineM
    cesium/      RenderGovernor, EntityRegistry
    context/     WorldContext types + adaptive radius
    sources/     Provider contract + OpenSky adapter
```

## Backend gateway

```
Browser → /api/v1/spatial → authenticate + attachOrgDb
  → openskyGateway (server credentials, cache, dedupe)
  → worldContextService (org vehicles + external aircraft)
```

Routes:
- `GET /api/v1/spatial/aircraft?bbox=w,s,e,n`
- `GET /api/v1/spatial/provider-health`
- `POST /api/v1/spatial/world-context`

## Freshness contract

| Class | Meaning |
|-------|--------|
| LIVE | observed within maxLiveMs |
| DELAYED | older but usable |
| STALE | beyond delayed window |
| UNKNOWN | missing/invalid observation time |

Never label LIVE solely because HTTP succeeded.
Never substitute receivedAt for missing observedAt as truth.

## Security

- org_id from JWT only
- No browser OpenSky secrets
- Bbox area capped (25 deg²)
- Radius capped (250 km)
- Allowlisted OpenSky endpoints only

## Cesium

One RenderGovernor per Viewer. EntityRegistry for selection identity.
Do not duplicate Cesium runtime.
