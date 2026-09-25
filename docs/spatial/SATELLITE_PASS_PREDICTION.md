# Satellite Pass Prediction

Gate 2 exposes a bounded, modelled-only orbital pass prediction surface.

## Endpoints

- `GET /api/v1/satellites` — CelesTrak TLE catalog plus SGP4-propagated positions when the propagator is available.
- `GET /api/v1/satellites/passes` — geometric AOS/LOS predictions for a ground observer.

### Pass query

Required: `lat`, `lng`.

Optional: `noradId`, `group`, `windowHours`, `horizonDeg`, `maxPasses`, `from`.

Hard bounds: prediction window <= 72 hours, returned passes <= 20, scanned objects <= 25.

## Semantics

Every predicted pass is explicitly marked:

- `positionSource: sgp4_modelled`
- `telemetryLive: false`
- `imagingClaim: false`
- `taskingClaim: false`

AOS/LOS are geometric horizon crossings computed from SGP4-propagated orbital state and the supplied Earth-fixed observer. They are not telemetry observations, imaging opportunities, or evidence of tasking rights.

## Deliberate boundary

This gate predicts orbital visibility only. It does not establish whether a satellite has a camera/sensor, whether imagery exists, whether a provider/operator can task the satellite, or whether any collection occurred.
