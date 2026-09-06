---
name: frontend-patterns
description: Sonalit's React architecture — TanStack Router shells, Zustand stores, feature modules, API client, realtime subscriptions, and component patterns.
triggers:
  - React
  - component
  - page
  - route
  - router
  - store
  - Zustand
  - hook
  - feature
  - frontend
  - web app
  - TanStack
related_skills:
  - frontend-design
  - frontend-design/design-review
  - realtime-events
  - auth-security
  - testing
---

# Frontend Patterns

## Purpose

Teaches Sonalit's actual React architecture — routing shells, state management, feature module structure, API client usage, and realtime subscription patterns. Follow these when adding or modifying frontend code.

## When to Activate

Any work in `apps/web/src/`.

## Routing — Three Shells

File: `apps/web/src/router.tsx`

TanStack Router with three parent route shells:

### 1. `authRoute` → AppShell

Standard authenticated pages. AppShell provides Rail (left sidebar), Topbar, mobile drawer + bottom nav.

```typescript
const myRoute = createRoute({
  getParentRoute: () => authRoute,
  path: '/my-page',
  component: lazyRouteComponent(() => import('./pages/MyPage.js')),
});
```

Most pages use this shell: `/fleet`, `/convoys`, `/alerts`, `/guardian`, `/settings`, etc.

### 2. `authFullscreenRoute` → FullscreenShell

Edge-to-edge viewport, no AppShell chrome. Only GlobalPanicAlarm overlay. Used for immersive views.

Pages using this: `/` (Orbit), `/cds`, `/field/*`, `/convoy-reports`, `/drive`

### 3. `portalRootRoute` → PortalLayout

Cargo owner portal. Separate auth domain (client JWT or portal token, not internal JWT). Own visual identity.

Pages using this: `/portal/login`, `/portal/dashboard`, `/portal/convoy/$convoy_id/*`

### Adding a new route

1. Choose the correct shell (authRoute for standard, authFullscreenRoute for immersive)
2. Create the route constant
3. Add it to the `routeTree` in the correct `.addChildren([])` array
4. Create the page component in `pages/`

## State Management — Zustand Stores

| Store | File | Scope |
|-------|------|-------|
| Auth | `stores/auth.ts` | Access token (module scope), user object, login/logout |
| UI | `stores/ui.ts` | Sidebar state, modals, transient UI |
| Dashboard | `stores/dashboardStore.ts` | Dashboard filter state |
| CDS | `pages/cds/store.ts` | CDS sub-app view state, drawer, toasts |

Pattern: one Zustand store per bounded domain. Feature-local state stays in feature dirs.

**Critical rule**: Access token lives in a module-scope variable in `stores/auth.ts`, NEVER in localStorage or sessionStorage.

## Feature Module Structure

```
features/
├── live-fleet/
│   ├── components/     → FleetMap, StatusStrip, VehiclePanel, DetailCard
│   ├── hooks/          → useLiveFleet (data + realtime subscription)
│   └── types/          → LiveVehicle, ConvoyGroup, StatusCounts
├── risk-intel/
│   ├── components/     → RiskMap, ThreatCard, LiveFeedPanel, Sparkline
│   ├── hooks/          → useRiskZones, useRiskRealtime, useLiveFeed
│   ├── types/          → risk.ts
│   └── utils/          → colors.ts, map.ts
├── comms/
│   ├── components/     → ChannelList, MessageStream, Composer
│   ├── hooks/          → useComms, useCommsRealtime
│   └── types/          → comms.ts
└── auth/
    └── login/          → LoginPage, AuthConsole, OperationsGlobe
```

Pattern: `components/`, `hooks/`, `types/` subdirectories. Hook handles data fetching + realtime. Components are pure rendering.

## API Client

File: `apps/web/src/lib/api.ts`

Axios instance with interceptors:
- **Auth**: injects `Authorization: Bearer <token>`
- **CSRF**: injects CSRF header on mutating requests
- **Tracing**: W3C `traceparent` header propagation
- **Refresh**: on 401, queues requests, refreshes token via cookie, replays

Base URL: `VITE_API_BASE_URL` (defaults to `/api/v1`)

```typescript
import { api } from '../lib/api.js';

// GET
const { data } = await api.get<{ data: Vehicle[] }>('/vehicles');

// POST
const { data } = await api.post<{ data: Vehicle }>('/vehicles', payload);
```

TanStack Query for data fetching:
```typescript
const { data } = useQuery({
  queryKey: ['vehicles'],
  queryFn: () => api.get('/vehicles').then(r => r.data.data),
});
```

## Realtime Subscriptions

File: `apps/web/src/lib/centrifuge.ts`

Multiplexed Centrifugo subscriptions — one Subscription per channel, fan-out to multiple handlers.

```typescript
import { subscribe } from '../lib/centrifuge.js';

useEffect(() => {
  if (!orgId) return;
  const unsub = subscribe<GpsEvent>(`org#${orgId}`, (data) => {
    if (data.type === 'location') {
      // handle GPS update
    }
  });
  return unsub;
}, [orgId]);
```

**Critical**: The org channel carries ALL event types (GPS, panic, geofence, convoy updates, comms). Always filter by `data.type` to handle only the event you care about.

Common channel patterns:
- `org#<orgId>` — all org events
- `portal#<convoyId>` — portal live updates
- `org:<orgId>:device:<deviceId>:telemetry` — device telemetry

## CDS Sub-App Pattern

`pages/cds/` is a self-contained sub-app with its own:
- Store: `store.ts` (CDSView, drawer, toasts, view mode)
- Types: `types.ts` (23 ShipmentStatus states, ContainerStatus, LockStatus, etc.)
- API: `api.ts`
- Hooks: `hooks.ts`
- Constants: `constants.ts`
- Components: `components.tsx`

It renders under `authFullscreenRoute` with its own chrome (no AppShell rail).

## Shared Components

Directory: `apps/web/src/components/`

- `layout/AppShell.tsx` — universal app chrome
- `layout/GlobalPanicAlarm.tsx` — panic overlay (always active)
- `layout/Rail.tsx` — left sidebar navigation
- `layout/DrawerNav.tsx` — mobile navigation drawer
- `CesiumLiveMap.tsx`, `CesiumTrailMap.tsx` — 3D globe maps
- `PortalMap.tsx` — portal map component
- `dashboard/` — TacticalMap, EventsTicker, ThreatStrip, KPIStrip, OpsSidebar, PanicAlarm

## Relevant Files

- `apps/web/src/router.tsx` — all routes
- `apps/web/src/stores/` — auth.ts, ui.ts, dashboardStore.ts
- `apps/web/src/lib/api.ts` — API client
- `apps/web/src/lib/centrifuge.ts` — realtime client
- `apps/web/src/features/` — feature modules
- `apps/web/src/pages/` — page components
- `apps/web/src/components/` — shared components

## Do

- Parent new routes under the correct shell
- Use feature module structure for complex features
- Filter realtime events by `type` field
- Use `api` from `lib/api.ts` for all HTTP requests
- Use TanStack Query for data fetching
- Keep CDS-specific code in `pages/cds/`

## Don't

- Create routes without choosing the correct shell
- Store auth tokens in localStorage
- Subscribe to Centrifugo without filtering by event type
- Put feature-specific state in global stores
- Mix CDS code into non-CDS components
