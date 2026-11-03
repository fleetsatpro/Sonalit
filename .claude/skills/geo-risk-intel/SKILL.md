---
name: geo-risk-intel
description: Geofence engine, route risk scoring, OSINT from 7 sources, corridor evaluation, dual-provider geocoding, and AI route analysis.
triggers:
  - geofence
  - risk zone
  - OSINT
  - route risk
  - risk intel
  - corridor
  - geocode
  - threat
  - risk event
  - route planning
related_skills:
  - convoy-system
  - realtime-events
  - backend-patterns
  - multi-tenancy
  - testing
---

# Geo & Risk Intelligence

## Purpose

Teaches the geospatial and risk intelligence layer — geofence evaluation, route risk scoring, OSINT collection, corridor monitoring, and AI-powered route analysis.

## When to Activate

Any work involving geofences, risk zones, route planning, OSINT, corridor evaluation, risk events, or geocoding.

## Geofence Engine

File: `backend/src/utils/geofenceEngine.js`

Evaluates GPS fixes against org geofences and convoy route corridors. All DB writes go through `withOrg()` per RULE C (multi-tenancy).

### Geofence Types

Supports polygon (ray-casting point-in-polygon), circular (haversine distance), and corridor (distance-to-segment) geofences.

### Geofence Cache

In-memory cache per org, 60-second TTL. Loads active geofences with: `id`, `name`, `type`, `coordinates`, `active`, `corridor_width_km`, `active_from_time`, `active_to_time`, `days_of_week`, `checkpoint_order`, `dwell_alert_min`.

### Time-Aware Activation

`isGeofenceActiveNow(fence)` checks:
- `days_of_week` array (0=Sun through 6=Sat)
- `active_from_time` / `active_to_time` window (HH:MM format, UTC)

### Geometry Functions

- `isPointInPolygon(lat, lng, coordinates)` — ray-casting algorithm, supports GeoJSON Polygon and custom path formats
- `extractRing(coordinates)` — normalises GeoJSON `{ type: 'Polygon', coordinates: [[[lng, lat]]] }` and custom `[[lat, lng]]` formats

## Route Risk Scoring

File: `backend/src/services/geo/routeRisk.js`

Scores candidate routes against known risk zones to pick the safest viable road.

### Scoring Formula

**Total score = Σ(exposure_km × SEVERITY_WEIGHT) + Σ(ENTRY_PENALTY) + (hours × HOURS_WEIGHT)**

### Severity Weights (per km inside zone)

| Level | Weight | Entry Penalty |
|-------|--------|---------------|
| `no_go` | 1000 | 1000 |
| `critical` | 60 | 25 |
| `high` | 20 | 8 |
| `medium` | 6 | 2.5 |
| `low` | 1.5 | 0.5 |

`HOURS_WEIGHT = 1` — among equally safe routes, the quicker one wins.

**`no_go` zones categorically block routes** — a route through one is disqualified outright.

### Exposure Calculation

`exposureKm(route, zone)` walks each segment, sampling at ~250m intervals. Returns `insideKm` and `nearestKm` to detect routes that clip zone edges.

Pure and planar-approximated (equirectangular) — deterministic and unit-testable with no DB or network.

## 4D Corridor Evaluation

File: `backend/src/services/geofence/corridor.js`

Route corridor with time dimension. `evaluateCorridor()` checks:
- **Space**: cross-track distance from planned route
- **Time**: schedule position (ahead/behind)

Returns: `off_route` (high), `behind` (medium), `ahead` (low), `on_track` (ok)

Corridor deviation ≥ 4× corridor width = critical severity.

Table: `convoy_route_corridors` (convoy_id, route_line, width_km, active)

## OSINT Risk Intelligence

File: `backend/src/utils/riskOsint.js`

7 sources for live ground coverage:

| Source | Access | Coverage |
|--------|--------|----------|
| GDELT | Free, no key | Global news-monitoring index |
| ReliefWeb | Free, no key | Humanitarian/conflict reports |
| GDACS | Free, no key | Natural hazard alerts (floods, cyclones, quakes) |
| ACLED | Free registration | Political violence at village/road level |
| AllAfrica RSS | Free, no key | African local outlets (Africa zones only) |
| Telegram | Public channels | Grassroots layer (configurable channels) |
| Claude web search | ANTHROPIC_API_KEY | Broader web synthesis |

### Classification

Keyword-based severity classification:
- **HIGH**: attack, ambush, kill, kidnap, abduct, bomb, explosion, gunfire, shoot, terrorist, insurgent, massacre, raid
- **MEDIUM**: protest, unrest, roadblock, strike, clash, robbery, bandit, checkpoint, tension, militia, curfew

GDELT tone-based: ≤ -7 = high, ≤ -2 = medium, else low.

### Deduplication

Stable `external_id` (URL hash or source's own event/message ID). Unique index `risk_events_zone_external_uniq` prevents duplicates on re-runs.

### Place Term Extraction

`extractPlaceTerms(zone)` splits `zone.region` on `/,` to extract individual place names for GDELT queries, since zone names ("Mokambo Crossing Banditry Zone") never appear verbatim in news.

Worker: `backend/src/workers/worker.risk.js`

## Geocoding

File: `backend/src/utils/geocode.js`

Dual-provider: Mapbox (primary) + OSRM (fallback). `geocodePlace()` for forward geocoding.

Route planning: `backend/src/services/geo/routePlan.js` — requests multiple road alternatives, scores against live risk zones.

## Risk Zones

Routes: `backend/src/routes/riskzones.js`, `backend/src/routes/risk.js`

Tables: `risk_zones` (with level, source columns), `risk_events` (with OSINT external_id)

## Relevant Files

- `backend/src/utils/geofenceEngine.js` — geofence evaluation engine
- `backend/src/services/geo/routeRisk.js` — route risk scoring
- `backend/src/services/geofence/corridor.js` — 4D corridor evaluation
- `backend/src/utils/riskOsint.js` — OSINT collection from 7 sources
- `backend/src/services/geo/routePlan.js` — route planning with alternatives
- `backend/src/utils/geocode.js` — dual-provider geocoding
- `backend/src/routes/riskzones.js` — risk zone CRUD
- `backend/src/routes/risk.js` — risk endpoints
- `backend/src/routes/corridors.js` — corridor management
- `backend/src/routes/geofences.js` — geofence CRUD
- `backend/src/workers/worker.risk.js` — risk intelligence worker

## Do

- Keep scoring functions pure and deterministic (no DB, no clock)
- Use `withOrg()` for all geofence DB writes (RULE C)
- Treat `no_go` zones as categorical blocks, not weighted
- Use the geofence cache (60s TTL) to avoid per-fix DB queries
- Deduplicate OSINT events by `external_id`

## Don't

- Skip exposure calculation — endpoint-only tests miss short zone crossings
- Ignore the time dimension in corridor evaluation
- Query geofences from DB on every GPS fix — use the cache
- Treat all OSINT sources as equally reliable — Telegram especially needs curation
- Hardcode zone coordinates — they come from the `risk_zones` table with RLS
