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

The repository does not yet contain a complete real maritime AIS ingestion path or a complete external traffic-provider fusion path in this implementation. Those remain future provider tracks and are not represented as fake live layers.

External aircraft context is currently bounded around the active spatial context centre rather than pretending to have route-wide global aircraft coverage.

Weather context samples up to three relevant points for a route-aware mission context.

These limitations are surfaced as coverage/availability semantics rather than hidden.
