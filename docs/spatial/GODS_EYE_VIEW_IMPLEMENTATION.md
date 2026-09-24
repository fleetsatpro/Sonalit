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
- Open-Meteo current weather

The resulting context is consumed by the spatial event detector, Copilot tool layer and the live fleet vehicle detail panel.

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
- NEAR
- NEAR_INCIDENT

Relations include distance where meaningful, confidence, operational confidence, evidence, provenance references and uncertainty.

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
- ENVIRONMENTAL_DETERIORATION

Events carry evidence, confidence, operational confidence, source references, uncertainty and a rule version.

Persistent events use the spatial_events table with organisation isolation and an open-condition uniqueness key to prevent repeated copies of the same state.

Machine-detected events are bridged into the existing Sonalit alert contract instead of creating a second alert system.

## Provider behaviour

OpenSky remains the external aircraft provider.

Open-Meteo is used for current weather observations. Weather severity is not used as a substitute for freshness; freshness is derived from the provider timestamp.

External movement and weather calls are cache/dedupe aware and report provider health.

Provider failure produces partial context where possible rather than collapsing the entire mission context.

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
