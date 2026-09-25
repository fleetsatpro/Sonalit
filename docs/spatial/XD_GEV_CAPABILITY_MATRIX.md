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
| USGS earthquakes | Spatial provider fabric | DEFERRED | Not part of this CCTV transfer. |
| NASA FIRMS active fires | Spatial provider fabric | DEFERRED | Not part of this CCTV transfer. |
| Satellites / orbital layer | Spatial provider fabric | DEFERRED | Next expansion gate after CCTV hardening. |

## Semantics

Nearest-camera ranking does not imply visual acquisition. A camera is linked to a target with VISIBLE_TO_CAMERA only when the target point satisfies the camera's declared geometric viewshed. Estimated camera pose lowers operational confidence and keeps the relation non-actionable.

Sample Kenya cameras are development fixtures only. Their coordinates are not asserted as real CCTV installations, their pose is explicitly estimated, and their media is explicitly synthetic.

External camera media is never accepted from a client-supplied URL. Server-side catalog entries must pass the CCTV host allowlist and SSRF checks before media retrieval.

## TfL source note

The optional TfL JamCam catalog uses TfL's public Unified API surface. TfL states that its open data is intended for developers and that access to the Unified API requires registration/subscription credentials depending on access level. Sonalit therefore keeps TfL ingestion disabled unless explicitly enabled and configured.

## Operational rule

XD Live Surveillance remains the operational authority. External CCTV enriches the canonical world state; it does not overwrite Sonalit telemetry, incidents, convoy state, e-lock state or evidence records.
