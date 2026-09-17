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
7. **EVIDENCE** — raw observations, photos, scans, signatures, e-lock events, telemetry and audit records supporting a world-state claim.
8. **FUTURE** — expected position, forecast trajectory and explicit scenario lanes. Forecast data must never be rendered as observed fact.

## World architecture
- **2D operational plane:** MapLibre is the primary fleet surface; it must remain usable without Cesium Ion.
- **3D/temporal plane:** Cesium is the elevated tactical/3D view for terrain, buildings, corridor volumes, uncertainty and temporal scene reconstruction.
- **Canonical state:** raw evidence remains authoritative. Deterministic geospatial reconciliation outranks AI interpretation.
- **Agent layer:** multiple specialist agents may interpret canonical state, correlate events and produce explanations; agents cannot create telemetry or silently mutate operational truth.

## Specialist swarm
The initial specialist registry contains 12 roles:
- Spatial Fusion
- Temporal Engine
- Entity Resolution
- Motion Analyst
- Source Integrity
- Security Correlation
- Evidence Auditor
- Trajectory Forecaster
- Route Sentinel
- Anomaly Challenger
- Scenario Lab
- Swarm Orchestrator

Model lanes should prioritize open-weight deployments, with Qwen3-VL variants used where image/video/spatial interpretation is actually needed. A lighter text model lane can service routine synthesis. Provider adapters must remain replaceable; the application must degrade to deterministic specialists if every model endpoint is unavailable.

## Operator UI
The visual hierarchy is intentionally world-first:
- top mission strip
- left 8D dimension rail
- central map/world canvas
- right selected-entity intelligence rail
- bottom temporal/event strip
- collapsible specialist swarm drawer
- render-quality telemetry and adaptive LOD controls

The map supports `AUTO` and `PAUSED` camera states. Live telemetry refresh must not hijack an operator's manual camera position.

## Rendering target
Do not build an enormous static bitmap. Use vector geometry, tiled imagery, adaptive level-of-detail, device-aware supersampling and GPU layers. Quality should expose `AUTO / HIGH / ULTRA / MAX` rather than pretending that a single browser canvas is literally a 16K/32K texture. The system should remain crisp on high-DPI 4K/5K/8K displays and scale its internal render resolution according to GPU capability.

## Safety and evidence rules
- Never fabricate a coordinate, event, route, risk observation or prediction.
- Every AI-generated interpretation carries provenance and confidence metadata.
- Actual, reconciled, expected and predicted states are visually distinct.
- Destructive or consequential agent actions require explicit human approval.
- Tenant isolation and auditability apply to all XD data and agent traces.
