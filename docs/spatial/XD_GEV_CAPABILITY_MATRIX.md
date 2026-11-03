# XD Live Surveillance — GEV Capability Matrix

This matrix records where GEV-derived capabilities live in Sonalit. It is a capability truth table, not a claim of feature parity with the upstream GEV project.

| Capability | Sonalit surface | State | Evidence / boundary |
|---|---|---|---|
| Canonical spatial observation model | Spatial Intelligence | OPERATIONAL | Shared SpatialObservation contract with freshness, provenance, coverage and confidence. |
| Multi-provider World Context | XD + Intelligence Centre | OPERATIONAL | Canonical provider fabric feeds World Context. |
| CCTV camera registry | XD Live Surveillance | OPERATIONAL (catalog) | First-class camera observations, pose, viewshed, health and provenance. |
| CCTV media | XD Live Surveillance | PARTIAL / SAFE-FALLBACK | Only camera-id mediated retrieval; allowlist + HTTPS + private-address/DNS checks; synthetic frame when no approved feed exists. |
| CCTV viewshed geometry | XD Live Surveillance | OPERATIONAL | FOV/range/heading geometry can say a target is geometrically visible; it cannot claim image acquisition. |
| Public camera sources | Provider fabric | PARTIAL | File catalog supported; optional TfL JamCam catalog behind explicit environment flag and credentials where required. |
| Person / face / plate surveillance | XD Live Surveillance | NOT IMPLEMENTED BY DESIGN | No identity extraction or plate/person tracking is introduced by CCTV. |
| USGS earthquakes | Spatial provider fabric + XD hazard fusion | OPERATIONAL | Public USGS GeoJSON catalog/query adapter; bounded coverage and low operational-confidence semantics. |
| NASA FIRMS active fire hotspots | Spatial provider fabric + XD hazard fusion | OPERATIONAL (credential-gated) | VIIRS area API adapter (default NOAA-21 NRT); `AUTH_REQUIRED` without `NASA_FIRMS_MAP_KEY`; hotspot detection is not treated as confirmed impact. |
| Satellites / orbital catalog | Spatial provider fabric + XD World Context | OPERATIONAL (catalog; modelled positions optional) | CelesTrak GP/NORAD catalog is allowlisted and bounded; spatial observations require an available SGP4 propagator. |

## Semantics

Nearest-camera ranking does not imply visual acquisition. A camera is linked to a target with VISIBLE_TO_CAMERA only when the target point satisfies the camera's declared geometric viewshed. Estimated camera pose lowers operational confidence and keeps the relation non-actionable.

Sample Kenya cameras are development fixtures only. Their coordinates are not asserted as real CCTV installations, their pose is explicitly estimated, and their media is explicitly synthetic.

External camera media is never accepted from a client-supplied URL. Server-side catalog entries must pass the CCTV host allowlist and SSRF checks before media retrieval.

## TfL source note

The optional TfL JamCam catalog uses TfL's public Unified API surface. TfL states that its open data is intended for developers and that access to the Unified API requires registration/subscription credentials depending on access level. Sonalit therefore keeps TfL ingestion disabled unless explicitly enabled and configured.

## Operational rule

XD Live Surveillance remains the operational authority. External CCTV enriches the canonical world state; it does not overwrite Sonalit telemetry, incidents, convoy state, e-lock state or evidence records.

## Hazard sensor semantics

USGS earthquake observations and NASA FIRMS hotspot observations are external detections. They are not automatically converted into road closure, damage, route disruption, fleet exposure, or other operational-impact assertions. World Context records source-specific health and provenance and reports the composite hazard layer as partial whenever one or more sensors are unavailable, rate-limited, credential-gated, stale, or coverage-bounded.

## Satellite/orbital semantics

CelesTrak catalog presence is not evidence of imaging capability, sensor modality, tasking rights, collection activity, or operator control. The production orbital path uses satellite.js TLE parsing/SGP4 propagation; positions are classified as MODELLED and carry explicit uncertainty because they are derived from GP/TLE orbital elements, not live telemetry. If satellite.js cannot be loaded, Sonalit withholds latitude/longitude rather than fabricating a ground position.

The satellite layer is bounded to an allowlisted CelesTrak group and a maximum of 40 spatial observations in World Context. It does not introduce named-person tracking, facial recognition, plate tracking, or automatic satellite imaging claims.

### TLE catalog limitation

CelesTrak documents that TLE formats only support five-digit catalog numbers. Sonalit therefore treats this TLE-backed phase as bounded orbital coverage for the allowlisted groups; six-digit objects require a future OMM JSON/CSV-capable path rather than silent truncation or omission being interpreted as global coverage.

## XD spatial UI polish (feat/xd-spatial-ui-polish)

| Surface | Upgrade |
|---|---|
| FleetMap spatial layers | Glow underlay + kind-coloured cores (orbital violet, camera teal) |
| World Context legend | Glass panel, layer key, modelled-only footer |
| SpatialContextCard | Premium metric strip, orbital/camera sections, fusion relations |
| Semantics | Unchanged — modelled ≠ telemetry; geometry ≠ acquisition |

