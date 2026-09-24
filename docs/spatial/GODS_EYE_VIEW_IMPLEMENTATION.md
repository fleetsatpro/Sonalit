# Sonalit God’s Eye View — Implemented Spatial Intelligence

This document describes the spatial-intelligence capabilities currently implemented in Sonalit. It is intentionally limited to behaviour that exists in the repository.

## Canonical data flow

Sonalit vehicle telemetry is read from the existing operational vehicle/GPS records. The spatial layer normalises those observations with freshness, provenance, quality and independent confidence dimensions. Mission route/corridor geometry is read from the existing convoy route/corridor records.

The world-context service then composes:

- operational vehicles and alerts
- convoy route/corridor state
- convoy checkpoints
- active organisation-scoped geofences
- convoy-linked shipment locations
- internal risk zones
- active incidents with coordinates when available
- OpenSky aircraft observations
- Kpler AIS vessel positions when KPLER_AIS_TOKEN is configured
- Mapbox Traffic segment congestion/closure observations when MAPBOX_ACCESS_TOKEN is configured
- TomTom Orbis traffic incidents and road/environmental hazards when TOMTOM_API_KEY is configured
- NASA EONET natural-event observations
- Open-Meteo current weather

All of these are assembled by the same canonical world-context service. External feeds are not treated as map-only overlays.
## Spatial truth rules

Sonalit remains operationally authoritative. External observations enrich context and do not overwrite operational state.

Each spatial observation can expose independent:

- observation confidence
- interpretation confidence
- operational confidence
- freshness
- provenance
- coverage
- uncertainty

Missing position data is not converted to 0,0, missing timestamps remain unknown, and stale observations remain stale.

## Route and corridor intelligence

For a convoy or assigned vehicle the world context can expose:

- route relationship
- cross-track distance
- route progress
- schedule delta
- corridor width
- previous route relationship
- nearby checkpoints
- checkpoint approach/pass state
- movement gap
- implied movement speed
- heading change
- stationary duration

The existing corridor evaluator remains the route/corridor computation authority.

## Spatial relationships

The relation layer derives evidence-backed relationships such as:

- ON_ROUTE
- OFF_ROUTE
- WITHIN_CORRIDOR
- APPROACHING
- CHECKPOINT_PASSED
- NEAR_CHECKPOINT
- WITHIN for active risk-zone containment
- HAZARD_NEAR_ROUTE
- NATURAL_HAZARD_NEAR_ROUTE
- EXTERNAL_HAZARD_NEAR_ROUTE
- EXTERNAL_INCIDENT_NEAR_ROUTE
- TRAFFIC_CLOSURE
- TRAFFIC_CONGESTION
- NEAR_TRAFFIC
- NEAR_MARITIME
- VESSEL_APPROACHING_DESTINATION
- NEAR
- NEAR_INCIDENT

External traffic, hazard and maritime observations are evaluated both against individual vehicles and, when a convoy route exists, against the route/corridor itself. This prevents route-impacting conditions farther ahead from disappearing merely because they are outside the vehicle's immediate radius.

Relations include distance where meaningful, route distance, relative direction, confidence, operational confidence, evidence, provenance references, relevance and uncertainty.
## Deterministic events

The spatial detector can emit:

- CORRIDOR_EXIT
- CORRIDOR_REENTRY
- ROUTE_DEVIATION
- STALE_TELEMETRY
- TELEMETRY_RECOVERED
- GPS_GAP
- POSITION_JUMP
- HEADING_ANOMALY
- UNEXPECTED_STOP
- LONG_DWELL
- CHECKPOINT_APPROACH
- CHECKPOINT_PASS
- INCIDENT_NEAR_CONVOY
- HAZARD_NEAR_ROUTE
- EXTERNAL_INCIDENT_NEAR_ROUTE
- EXTERNAL_HAZARD_NEAR_ROUTE
- NATURAL_HAZARD_NEAR_ROUTE
- TRAFFIC_CLOSURE
- TRAFFIC_CONGESTION
- VESSEL_APPROACHING_DESTINATION
- ENVIRONMENTAL_DETERIORATION

Events carry evidence, confidence, operational confidence, source references, uncertainty and a rule version.

Persistent events use the spatial_events table with organisation isolation and an open-condition uniqueness key to prevent repeated copies of the same state.

Machine-detected events are bridged into the existing Sonalit alert contract instead of creating a second alert system.
## Provider behaviour

God's Eye external feeds are first-class inputs to the same canonical world model:

- **Aircraft:** OpenSky.
- **Maritime/AIS:** Kpler Maritime 2.0 GraphQL. Kpler documents area-of-interest filtering and vessel last-position fields.
- **Road traffic:** Mapbox Traffic v1 through Tilequery. The feed exposes congestion and road-closure state; Mapbox documents an approximately 8-minute congestion update cadence.
- **Road incidents/hazards:** TomTom Orbis Traffic Incident Details, queried by route-derived bounding box. It supports present incidents and categories including accidents, road closures, roadworks and flooding, with last-report timestamps.
- **Natural hazards:** NASA EONET v3 open events, bounded by the mission area.
- **Weather:** Open-Meteo current observations.

Every external provider has bounded cache, request deduplication, local concurrency/rate protection, timeout handling, circuit breaking and stale-cache fallback where appropriate. Provider health is exposed through the spatial provider-health endpoint and layer health is carried inside world context.

External observations never overwrite operational Sonalit state. Route-level and vehicle-level relationships are deterministic, and actionable relationships can flow into the existing spatial event and alert authority.

Provider credentials are server-side only. If a paid provider is not configured, Sonalit reports AUTH_REQUIRED or UNAVAILABLE for that layer rather than fabricating data.
## Copilot

The get_world_context Copilot tool calls the same canonical backend world-context service used by the application.

The Copilot therefore receives mission context, route/corridor state, relations, events, environment, security, provenance, freshness, coverage and uncertainty from one source.

The tool is organisation-scoped from the authenticated session and does not accept a caller-supplied organisation identifier.

## Operator UI

Vehicle inspection on the live fleet page now exposes a compact God’s Eye context panel with:

- route state
- progress
- cross-track distance
- schedule relationship
- nearest checkpoint
- weather/hazard context
- relevant spatial relations
- active spatial events
- unavailable context layers
- uncertainty/warnings

Operational vehicle GPS remains authoritative when spatial context is unavailable.

## Current deliberate boundaries

The external feed fabric is real but configuration-dependent. Missing credentials produce explicit provider and layer health states rather than fake observations.

AIS and traffic coverage is bounded by the mission-derived spatial area and provider request budgets. Traffic flow is sampled across route points and traffic incidents are queried over a route-aware bounding box; Sonalit does not pretend to have unrestricted global road telemetry.

NASA EONET geometry can be polygonal. When a single point is required for a relation calculation, Sonalit records that the representative point was derived and lowers interpretation confidence accordingly.

Sonalit now also exposes NASA GIBS true-colour Earth-observation imagery as a native Cesium map mode. GIBS is imagery rather than a point observation, so it remains a visual intelligence layer; semantic hazards and events continue to enter world context through observation providers such as NASA EONET. Future higher-resolution commercial EO or SAR feeds should follow the same provider contract instead of becoming disconnected map widgets.

Operational Sonalit vehicle GPS, routes, corridors, security records and alert authority remain the system's operational source of truth.



## Route-aware query planning

God's Eye View now plans long route/corridor queries as bounded provider-safe AOIs rather than collapsing an oversized route envelope back to the convoy centre. The canonical route query planner provides:

- bounded multi-AOI partitioning
- adaptive route samples
- provider-safe AOI area limits
- maximum AOI count and bounded concurrency
- antimeridian-safe splitting
- observation deduplication across overlapping AOIs
- route coverage ratio and route distance coverage

Aircraft, AIS, NASA EONET hazards and TomTom traffic incidents use the route AOI plan when route geometry exists. Traffic flow and weather use the same route-aware adaptive sample strategy.

## Event lifecycle and truth preservation

Spatial events are divided into stateful conditions and point-in-time occurrences. Stateful conditions are refreshed rather than duplicated on every evaluation. Automatic resolution is permitted only when the current request has authoritative, sufficiently fresh provider coverage; provider failure, stale data, missing samples and incomplete route coverage cannot be interpreted as evidence that a condition disappeared.

Spatial event rows retain last_seen_at and resolution_reason. Linked Sonalit alerts are reconciled with the event lifecycle, and spatial alert identity is persisted in alert metadata to protect against concurrent duplicate emissions.

The continuous Spatial Eye evaluator runs as a separate cadence within the existing intelligence worker rather than creating a second scheduler. Convoy evaluation is keyset-paged and bounded by configurable cycle size and concurrency so later organisations/convoys are not starved by a permanently fixed top-N query.

## Tenant and provider quota controls

The provider fabric now supports both process-level provider-family budgets and per-tenant budgets. Capabilities sharing a provider family (for example TomTom traffic flow and incidents) share a quota bucket while preserving capability-specific health and failure state. Spatial requests carry organisation context into the provider fabric so one tenant cannot consume an entire in-process provider budget.

World Context exposes both process/provider health and the current request's provider coverage. Event reconciliation uses the latter when source provenance identifies an external authority, preventing a globally healthy provider from being mistaken for complete coverage of the current mission query.


## Runtime controls

The spatial runtime exposes bounded controls through environment variables:

- SPATIAL_EYE_INTERVAL_SECONDS — cadence for continuous convoy spatial evaluation (minimum 15 seconds).
- SPATIAL_EYE_MAX_CONVOYS_PER_CYCLE — maximum active convoys evaluated in one spatial cycle.
- SPATIAL_EYE_CONCURRENCY — bounded concurrent convoy evaluations.
- SPATIAL_EYE_PROVIDER_CONCURRENCY — bounded concurrent route-AOI provider calls.
- SPATIAL_EYE_MAX_AOI_AREA_DEG2 — maximum geographic area of a generated provider AOI.
- SPATIAL_EYE_MAX_AOIS — maximum route AOIs per world-context provider query.
- SPATIAL_PROVIDER_<PROVIDER>_MAX_PER_MINUTE — process-level provider budget.
- SPATIAL_PROVIDER_<PROVIDER>_MAX_CONCURRENT — process-level provider concurrency.
- SPATIAL_PROVIDER_<PROVIDER>_TENANT_MAX_PER_MINUTE — per-tenant provider budget.
- SPATIAL_PROVIDER_<PROVIDER>_TENANT_MAX_CONCURRENT — per-tenant provider concurrency.
- SPATIAL_PROVIDER_MAX_TENANT_BUCKETS — maximum retained in-process tenant quota buckets.

The controls are hard-bounded by the application. Environment variables cannot request unlimited spatial area, AOIs, concurrency, or entity counts.
