# CesiumLiveMap + RenderGovernor + EntityRegistry

Target: `apps/web/src/components/CesiumLiveMap.tsx`

## Imports

```ts
import { RenderGovernor, EntityRegistry } from '@sonalit/spatial-intelligence';
```

## Viewer init

```ts
const governor = new RenderGovernor();
governor.install(viewer);
governorRef.current = governor;

const registry = new EntityRegistry();
registryRef.current = registry;
```

## Cleanup

```ts
governor.destroy();
registry.clear();
handler?.destroy();
if (viewer && !viewer.isDestroyed()) viewer.destroy();
```

## Selection

```ts
const picked = viewer.scene.pick(click.position);
if (Cesium.defined(picked) && picked.id instanceof Cesium.Entity) {
  const desc = registry.resolvePick(String(picked.id.id));
  if (desc?.domain === 'sonalit' && desc.entityType !== 'geofence') {
    onSelect(desc.id);
  }
} else {
  onDeselect();
}
```

## After entity updates

```ts
governor.requestRender('locations-sync');
```

## Registration example

```ts
registry.register({
  id: loc.device_id,
  domain: 'sonalit',
  entityType: 'device',
  cesiumId: loc.device_id,
  label,
  vehicleId: loc.vehicle_id ?? undefined,
});
```

Geofences and guardians register with their own entityType; domain remains `sonalit`.
External aircraft (future) use `domain: 'external'` and must not call operational onSelect.
