# Third-Party Notices — Spatial Intelligence

## Code patterns adapted from God’s Eye View

- https://github.com/bilawalsidhu/gods-eye-view
- License: MIT (source code only)
- Copyright (c) 2026 Bilawal Sidhu

Adapted (rewritten TypeScript for Sonalit):
- Render governor hold model
- Freshness / quality separation
- Observation normalization discipline

Not copied: GEV visual identity, media, bundled datasets, Pinokio tooling.

## OpenSky Network

- https://opensky-network.org/
- Attribution required
- Rate limits / credits apply to `/states/all`
- Credentials server-side only (`OPENSKY_CLIENT_ID`, `OPENSKY_CLIENT_SECRET`)

## CesiumJS

- Already a Sonalit dependency (`cesium@^1.141.0`)
- Apache-2.0


## USGS Earthquake Hazards Program

- https://earthquake.usgs.gov/
- Programmatic earthquake catalog / GeoJSON feed.
- Source observations remain attributed to USGS and are represented as external hazard detections.
- No API key is required for the public query path used by Sonalit.

## NASA FIRMS

- https://firms.modaps.eosdis.nasa.gov/
- VIIRS active-fire hotspot detections through the FIRMS Area API.
- NASA_FIRMS_MAP_KEY is required by the provider; Sonalit returns AUTH_REQUIRED when it is absent rather than substituting synthetic hazard data.
- Attribution/provenance is preserved on each hotspot observation.

## CelesTrak

- https://celestrak.org/
- GP/NORAD public orbital-element catalog used for bounded satellite/orbital enrichment.
- The Sonalit adapter uses an explicit allowlist of CelesTrak groups.
- CelesTrak catalog data is not treated as evidence of imaging capability or tasking rights.
- SGP4 propagation is optional; when unavailable, Sonalit reports the catalog without fabricating ground positions.

## satellite.js

- https://www.npmjs.com/package/satellite.js
- MIT license.
- Production dependency used for TLE-based SGP4/SDP4 propagation and coordinate conversion.
- Sonalit records propagated positions as modelled orbital positions, not live satellite telemetry.
