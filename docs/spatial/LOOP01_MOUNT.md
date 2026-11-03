# Loop 01 — Mount and wire-up checklist

## Backend (`backend/src/app.js`)

Add near other route mounts (after dashboard is fine):

```js
try {
  app.use("/api/v1/spatial", require("./routes/spatial"));
  logger.info("Route loaded: /api/v1/spatial");
} catch (e) {
  logger.warn("Spatial route failed: " + e.message);
}
```

## Env (server only)

```
OPENSKY_CLIENT_ID=
OPENSKY_CLIENT_SECRET=
```

Anonymous OpenSky works with stricter rate limits if credentials are absent.

## Web (`apps/web/package.json`)

```json
"@sonalit/spatial-intelligence": "workspace:*"
```

Then `pnpm install` from repo root.

## CesiumLiveMap

See `docs/spatial/CESIUM_LIVEMAP_INTEGRATION.md`.

Import:

```ts
import { RenderGovernor, EntityRegistry } from '@sonalit/spatial-intelligence';
```

- One `RenderGovernor` per Viewer; `install` after construction; `destroy` on unmount.
- Register vehicles / guardians / geofences in `EntityRegistry` with `domain: 'sonalit'`.
- Resolve picks via `registry.resolvePick(picked.id.id)`.
- Call `governor.requestRender('locations-sync')` after entity position updates.
