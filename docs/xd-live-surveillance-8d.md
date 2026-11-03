# XD Live Surveillance — 8D World Control

## Product intent
Replace the former "4D Geofence" concept with **XD Live Surveillance**: a spatial, temporal, identity-aware, motion-aware, evidence-aware, security-aware and forecast-aware operational world surface for authorised logistics/security operations.

## Eight dimensions
1. **SPACE** — latitude, longitude, altitude, route geometry, corridor membership, risk-zone geometry.
2. **TIME** — observation timestamps, historical playback, schedule position, event chronology and forecast windows.
3. **IDENTITY** — vehicle, device, driver/CFO, convoy, client, shipment/container and tracking-source relationships.
4. **MOTION** — speed, heading, acceleration, route progress, cross-track deviation and ETA.
5. **INTEGRITY** — source provenance, freshness, reconciliation state, confidence, uncertainty and source conflict.
6. **SECURITY** — risk zones, incidents, restricted areas, exposure, checkpoint state and e-lock state.
7. **EVIDENCE** — raw telemetry, photos, scans, signatures, e-lock events, telemetry and audit records supporting a world-state claim.
8. **FUTURE** — expected position, forecast trajectory and explicit scenario lanes. Forecast data must never be rendered as observed fact.

## World architecture
- **2D operational plane:** MapLibre is the primary fleet surface; it must remain usable without Cesium Ion.
- **3D/temporal plane:** Cesium is the elevated tactical/3D view for terrain, buildings, corridor volumes, uncertainty and temporal scene reconstruction.
- **Canonical state:** raw evidence remains authoritative. Deterministic geospatial reconciliation outranks AI interpretation.
- **Agent layer:** specialist agents may interpret canonical state, correlate events and produce explanations; agents cannot create telemetry or silently mutate operational truth.

## Specialist swarm
The XD model swarm contains **19 stages**: 18 independent specialists plus a final arbiter. The roles cover spatial fusion, temporal reconstruction, entity resolution, motion, source integrity, anomaly challenge, security correlation, risk exposure, checkpoints, e-locks, evidence, telemetry, route adherence, fleet health, client context, trajectory forecasting, scenario analysis, red-team challenge and synthesis.

The server uses Sonalit's existing provider fabric, which is configured **open-weight first** across five independent model slots, followed by GPT-OSS fallback lanes and Anthropic as last resort. Model endpoints are environment-configured so Sonalit can self-host through vLLM/SGLang or use a compatible inference service. Deterministic surveillance remains available when every model provider is unavailable.

## Operator UI
The visual hierarchy is world-first:
- top mission strip
- left 8D dimension rail
- central map/world canvas
- right selected-entity intelligence rail
- bottom temporal/event strip
- collapsible specialist swarm drawer
- adaptive render/LOD telemetry

The map supports explicit operator camera control. Live telemetry refresh must not hijack a manual camera position.

## Rendering target
Do not build an enormous static bitmap. Use vector geometry, tiled imagery, adaptive level-of-detail, device-aware supersampling and GPU layers. Expose render intent such as `AUTO / HIGH / ULTRA / MAX` only when backed by actual renderer controls. Support high-DPI 4K/5K/8K displays through adaptive internal resolution rather than promising a single fixed gigantic texture.

## Evidence and safety rules
- Never fabricate a coordinate, event, route, risk observation or prediction.
- Every AI-generated interpretation carries provider and confidence metadata.
- Actual, reconciled, expected and predicted states remain visually distinct.
- Model output is advisory; consequential actions require explicit human approval.
- Tenant isolation and auditability apply to all XD data and model traces.
