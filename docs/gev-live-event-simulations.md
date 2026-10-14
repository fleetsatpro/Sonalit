# GEV Live Event Simulations

## Product behavior

The God’s Eye View `LIVE SIM` layer works in the 2D MapLibre map and the 3D Cesium globe. It combines a time-stepped weather forecast view with source-attributed earthquake, volcanic-activity, and other natural-event markers.

The imagery is an operational visualization, not a substitute for official hazard warnings.

## Data sources and refresh cadence

| Layer | Source | Backend cache | Data semantics |
|---|---|---:|---|
| Weather | Open-Meteo Forecast API | 10 minutes per grid point | Hourly numerical forecast, up to 7 steps. Model point samples are not radar returns, exact storm boundaries, or guaranteed on-ground measurements. |
| Earthquakes | USGS ComCat GeoJSON M2.5+ past-day feed | 60 seconds | Catalogued epicentres with event time, magnitude, and depth. Pulse is not a shaking or damage footprint. |
| US volcano alerts | USGS Volcano Hazards Program elevated-volcano feed | 60 seconds | Current set of volcanoes in elevated alert states; notice time is retained separately from feed retrieval time. |
| Global volcano activity | Smithsonian Global Volcanism Program / USGS Weekly Volcanic Activity Report | 30 minutes; catalogue 24 hours | Global weekly reports matched to the Smithsonian volcano catalogue. This is not a global real-time sensor feed. |
| Global open natural events | NASA EONET v3 GeoJSON | 2 minutes | Curated open event metadata. Point sources remain point markers; line/polygon geometries use a computed centre for location only. The visual does not draw an unsupported perimeter. |

Provider records retain source identifiers, links, timestamps, freshness, and semantics in the API response and selection details. Source failures are reported independently; one failing feed must not suppress other successful layers.

## Commercial weather API configuration

Open-Meteo's free API is restricted to non-commercial use. A production Sonalit deployment must configure a licensed customer API key in the **backend** environment:

- `OPEN_METEO_API_KEY`: required for commercial use; requests use `customer-api.open-meteo.com`.
- `OPEN_METEO_API_BASE`: optional explicit provider endpoint override for approved deployments.
- `OPEN_METEO_ALLOW_FREE_NONCOMMERCIAL=true`: only for deployments that are genuinely non-commercial. Do not enable this for Sonalit production.

When neither the licensed key nor the explicit non-commercial opt-in is available, the weather provider returns `UNAVAILABLE` with `commercial_api_key_not_configured`. The UI must communicate that state rather than fabricating or silently substituting weather.

Open-Meteo data attribution is required under CC BY 4.0. Keep the provider link visible wherever weather-model values are displayed.

## Visual and operational rules

- Keep event animations restrained, phase-offset, and disabled when the user requests reduced motion.
- Use distinct, category-coded markers; thin earthquake and EONET event counts by zoom so the map stays legible. Do not create faux heatmaps from a sparse event catalogue.
- Preserve source geometry type and coordinate count. A centre calculated from a polygon or line is a locator only; do not render it as an observed hazard boundary.
- For US volcanoes, distinguish ground alert level (`NORMAL`, `ADVISORY`, `WATCH`, `WARNING`) from aviation colour code (`GREEN`, `YELLOW`, `ORANGE`, `RED`). These are separate signal dimensions in the USGS system.
- Weather timeline steps describe forecast-valid time. They are not a replay of measured weather history.
- All source data is enrichment. Sonalit's live vehicle telemetry and operational records remain authoritative for fleet operations.

## Verification

The backend unit tests cover bounded forecast-grid generation, weather-code normalization, earthquake coordinate/event mapping, weekly volcano report parsing and catalogue matching, current USGS elevated-alert mapping, NASA EONET geometry/provenance, and commercial weather-access policy. Run these using the repository's backend Jest test suite.
