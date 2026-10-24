# Sonalit Optical Reconnaissance — Ultra-High-Definition imagery

## Decision
Use Vantor Vivid Mosaic as the preferred high-detail basemap candidate. The first integration supports the Vivid Mosaic 30 cm product (VIVID_STANDARD_30), with the 15 cm HD product (VIVID_ADVANCED_15) available only when the commercial account explicitly entitles Sonalit to it and coverage exists for the viewport. Airbus Pléiades Neo and Planet SkySat remain acquisition/catalog options to evaluate separately.

## Provider protocol
- Provider: Vantor Hub Streaming — Basemaps WMTS.
- Endpoint: https://api.maxar.com/basemaps/v1/ogc/gwc/service/wmts
- Layer: Maxar:Imagery; matrix set: EPSG:3857; tile matrix: EPSG:3857:{z}.
- Product filtering: productName='VIVID_STANDARD_30' or productName='VIVID_ADVANCED_15'.
- Authentication: backend-only maxar-api-key header. Never expose the key to browser JavaScript, query strings, logs, or telemetry.
- Documentation: https://developers.maxar.com/docs/streaming-basemap/guides/wmts-basemap and https://vantor.com/product/vivid/mosaic/

## Free/open imagery path

The workstation also exposes **OPEN UHD**, a separate OpenAerialMap/HOTOSM global imagery mosaic. This avoids a commercial key and uses HOTOSM's documented XYZ endpoint:

- `https://global.imagery.hotosm.org/{z}/{x}/{y}.png`
- Zoom levels 0–13 show the global coverage grid, not imagery. Zoom 14+ serves contributed imagery where available.
- Use the STAC catalogue (`https://api.imagery.hotosm.org/stac/search`) to discover individual scenes and the per-item TiTiler endpoint to render a selected item.
- The imagery is contributor-supplied and heterogeneous. Do not claim a uniform native resolution, recent acquisition, or universal UHD coverage from the global mosaic. Prefer item-specific scene metadata when displaying a single image.
- Item-specific catalogue candidates are not rendered unless an explicit, recognised item licence is present. Missing licence metadata is surfaced as unresolved rather than silently assuming CC-BY.
- Tile responses must be images; an upstream HTML/XML error response is rejected rather than presented as imagery.

### Open Cities archive

The Open Cities AI Challenge dataset is a downloadable, fixed-footprint African drone-imagery archive hosted on Source Cooperative under ODbL-1.0; it is not a global live tile service. It is documented as a candidate for a future, separately catalogued archive layer after verifying coverage, file layout, attribution and ODbL obligations. Do not ingest it into live rendering or expose it as general commercial-use imagery without that review.

## Enablement gate
Configure these backend environment variables only after the signed contract permits streaming/embedding imagery in the Sonalit multi-tenant product and the provider account has been provisioned:
- VANTOR_API_KEY: API key from the provisioned Vantor Hub account.
- VANTOR_VIVID_ENABLED=true: explicitly enables this provider path.
- VANTOR_VIVID_LICENSE_CONFIRMED=true: operator acknowledgement that legal/procurement confirmed commercial streaming rights, end-user terms, attribution, retention/caching rules and fees.
- VANTOR_VIVID_PRODUCT=VIVID_STANDARD_30: defaults to the 30 cm product; use VIVID_ADVANCED_15 only if specifically entitled and commercially approved.

A key alone must not enable commercial imagery. Missing or invalid settings keep the button disabled. Product entitlement and geographic coverage are provider-dependent; 30 cm / 15 cm is provider product GSD, not native sensor resolution for every location.

## Cost, licensing and caching
- Confirm service area, tile-use rights, attribution, customer count, permitted concurrent sessions, data residency and usage quotas before enabling.
- Vantor tiles are not locally cached by the Sonalit gateway pending explicit confirmation that the contract permits it. HTTP caching is disabled for this path.
- The provider key is sent in a header from the backend only.
- Do not turn off the licence gate merely to make a preview render.

## Semantics and quality gates
- Basemap mosaic and time-specific scene catalogue are separate. Mosaic tile does not imply all pixels share one acquisition date.
- The UI calls resolution product GSD, never native sensor GSD.
- 15 cm must not imply global 15 cm coverage.
- Sentinel-2 and MODIS remain dated/context imagery, not equivalent high-detail sources.
- Live GPS remains operational authority; imagery is contextual evidence only.
- Tests cover OpenAerialMap global XYZ URL construction/caching, non-image rejection, missing item-licence rejection, Vantor fail-closed configuration, WMTS URL construction, secret-in-header behavior and non-caching of commercial tiles.

## Pre-production acceptance
1. Procurement/legal confirmation of signed rights and per-tenant display/redistribution rules.
2. Licensed-account tile tests over Nairobi, Mombasa, a rural Kenya–Tanzania corridor and a DRC operational AOI.
3. Confirm coverage, metadata, valid tile response, visual detail at intended zooms, latency, failures, request limits and expected cost.
4. Compare imagery at identical zooms with Airbus archive imagery and a SkySat sample where each has coverage.
5. Visual QA at 390×844, 768×1024, 1440×900 and 1920×1080.
6. Keep Vantor disabled until all gates pass. Never report product GSD as native sensor resolution without source evidence. For OpenAerialMap, distinguish its low-zoom coverage grid from contributed imagery and do not promise global UHD.
