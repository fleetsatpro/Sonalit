---
name: frontend-design/frontend-stack
description: Production frontend technology stack — React 18, Vite, TanStack, Tailwind, Zustand, MapLibre/CesiumJS, Recharts, and the open-source libraries powering Sonalit's UI.
triggers:
  - stack
  - dependencies
  - library
  - package
  - npm
  - pnpm
  - component library
  - framework
  - architecture overview
  - technology
  - what libraries
  - what framework
related_skills:
  - frontend-design
  - frontend-design/dark-theme-mastery
  - frontend-design/data-dense-design
  - frontend-design/map-ux
  - frontend-design/responsive-layout
  - frontend-design/ui-ux-pro
  - frontend-patterns
  - testing
---

# Frontend Stack

## Purpose

Documents the complete production frontend technology stack. Prevents introducing duplicate or conflicting libraries, ensures new dependencies fit the existing architecture, and provides the decision rationale behind each layer. Every library listed here is open-source with a permissive licence.

## When to Activate

When choosing a library, evaluating whether to add a dependency, or explaining the frontend architecture to someone new.

## The Stack at a Glance

```
RENDERING     React 18 + Vite 6
ROUTING       TanStack Router
DATA          TanStack Query + TanStack Table + Zustand
FORMS         React Hook Form + Zod (@hookform/resolvers)
STYLING       Tailwind CSS 3 + CSS custom properties (design tokens)
ICONS         Lucide React
MAPS 2D       MapLibre GL JS + react-map-gl
MAPS 3D       CesiumJS + Deck.gl
CHARTS        Recharts (lazy-loaded) + D3
REALTIME      Centrifugo v5 (centrifuge client)
I18N          i18next + react-i18next
COLLAB        Yjs (CRDT)
TELEMETRY     OpenTelemetry (browser SDK)
ERRORS        Sentry React
PWA           Workbox (vite-plugin-pwa)
TESTING       Vitest + Testing Library + Playwright + axe-core
TYPES         TypeScript 5 strict + @sonalit/contracts (Zod schemas)
```

## Layer-by-Layer Reference

### Rendering — React 18 + Vite 6

File: `apps/web/vite.config.ts`

- **React 18** with `@vitejs/plugin-react` (SWC transform)
- **Vite 6** for dev server (port 3000) and production builds
- **No SSR / No Next.js** — this is a single-page application
- **Code splitting**: manual chunks for react, tanstack, maps, crdt, forms

```typescript
manualChunks: {
  react: ['react', 'react-dom'],
  tanstack: ['@tanstack/react-router', '@tanstack/react-query'],
  maps: ['maplibre-gl', 'deck.gl'],
  crdt: ['yjs'],
  forms: ['react-hook-form', 'zod'],
},
```

### Routing — TanStack Router

- File-based type-safe routing
- `authRoute` → AppShell (standard chrome)
- `authFullscreenRoute` → FullscreenShell (edge-to-edge)
- `portalRootRoute` → PortalLayout (external users)

### Data Fetching — TanStack Query

```typescript
import { useQuery } from '@tanstack/react-query';
const { data } = useQuery({ queryKey: ['fleet'], queryFn: fetchFleet });
```

- All API calls go through `lib/api.ts` (Axios with auth interceptor)
- `staleTime` and `refetchInterval` tuned per-query for ops freshness
- Query keys are structured arrays for cache invalidation

### Tables — TanStack Table

```typescript
import { useReactTable } from '@tanstack/react-table';
```

Used for fleet lists, shipment tables, driver rosters, alert logs, and all paginated data views.

### State — Zustand

```typescript
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
```

Three main stores:
- `stores/auth.ts` — user, tokens, RBAC role
- `stores/ui.ts` — theme, sidebar state
- `stores/dashboardStore.ts` — real-time dashboard data

Feature-local state lives in feature directories.

### Forms — React Hook Form + Zod

```typescript
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
```

- Zod schemas defined in `@sonalit/contracts` are the source of truth
- `@hookform/resolvers` bridges Zod ↔ React Hook Form
- Used for convoy creation, incident reports, settings, driver management

### Styling — Tailwind CSS 3 + Design Tokens

File: `apps/web/tailwind.config.ts`

- Tailwind for utility classes
- CSS custom properties for the design system (see dark-theme-mastery skill)
- Three token systems: `--d-*` (dashboard), `--p-*` (primary), CDS ink/text tokens
- Tailwind config extends `colors` with all `--d-*` tokens for class-based access

### Icons — Lucide React

```typescript
import { Bell, MapPin, Truck, AlertTriangle } from 'lucide-react';
```

- 1600+ SVG icons, tree-shakeable
- ISC licence
- Used across all components — `<Icon size={15} strokeWidth={1.6} />`

### Maps — MapLibre + CesiumJS

- **MapLibre GL JS**: 2D fleet tracking, risk zones, geofences, traffic
- **CesiumJS**: 3D globe, trail replay, corridor geofences
- **Deck.gl**: High-performance WebGL overlay layers
- **react-map-gl**: React wrapper for MapLibre (used in some components)

### Charts — Recharts + D3

- **Recharts**: bar/line/pie charts, lazy-loaded via `React.lazy`
- **D3**: low-level data transformations, TopoJSON parsing, custom SVGs

### Realtime — Centrifugo v5

File: `apps/web/src/lib/centrifuge.ts`

WebSocket subscriptions multiplexed to handler callbacks.

### Internationalisation — i18next

```typescript
import { useTranslation } from 'react-i18next';
const { t } = useTranslation();
```

Browser language detection via `i18next-browser-languagedetector`.

### Testing

| Tool | Purpose | Command |
|------|---------|---------|
| Vitest | Unit/component tests | `pnpm test:unit` |
| Testing Library | React component rendering | With Vitest |
| Playwright | E2E browser tests | `pnpm test:e2e` |
| axe-core | Accessibility auditing | Via @axe-core/playwright |

### Type Safety — TypeScript + Contracts

- TypeScript 5 in strict mode
- `@sonalit/contracts` provides shared Zod schemas and TypeScript types
- Build contracts first: `pnpm build:contracts`

## What NOT to Install

These libraries would conflict with the existing stack:

| Library | Why Not |
|---------|---------|
| shadcn/ui | Custom design system (luminance ladder, signal colours) already handles all component styling |
| Radix UI | Components are purpose-built for the ops-dark aesthetic; Radix primitives would fight the token system |
| Next.js | Vite + TanStack Router SPA; no SSR needed |
| Styled Components | Tailwind + CSS custom properties is the styling layer |
| CSS Modules | Same reason — Tailwind is the convention |
| Framer Motion | 12+ custom CSS keyframe animations tuned for ops feel; Motion would duplicate |
| Material UI / Ant Design / Chakra | Custom design system; any off-the-shelf UI kit would clash |
| Storybook | Not part of the current workflow; adds significant devDep overhead |
| Redux / MobX | Zustand is the state manager |
| SWR | TanStack Query handles data fetching |
| Axios alternatives (got, ky) | `lib/api.ts` wraps Axios with auth + CSRF + tracing |
| Font Awesome | Lucide React is the icon system |

## Adding a New Dependency

Before adding any npm package:

1. **Check this skill** — is the functionality already covered?
2. **Check existing code** — is there a project utility that does it?
3. **Size matters** — run `npx bundlephobia <pkg>` or check bundlephobia.com
4. **Licence** — must be MIT, Apache-2.0, BSD, ISC, or similarly permissive
5. **Maintenance** — prefer actively maintained projects with >1k GitHub stars

If the package passes all checks, add it to the appropriate `manualChunks` group in `vite.config.ts` to keep bundle splits clean.

## Relevant Files

- `apps/web/package.json` — all frontend dependencies
- `apps/web/vite.config.ts` — build config, plugins, code splitting
- `apps/web/tailwind.config.ts` — Tailwind theme extensions, design tokens
- `apps/web/tsconfig.json` — TypeScript config, path aliases
- `apps/web/playwright.config.ts` — E2E test config
- `apps/web/postcss.config.js` — PostCSS plugins (Tailwind, autoprefixer)
- `apps/web/src/lib/api.ts` — Axios instance with auth/CSRF/tracing
- `apps/web/src/lib/centrifuge.ts` — Centrifugo realtime client
- `apps/web/src/stores/auth.ts` — Auth store (Zustand)
- `apps/web/src/stores/ui.ts` — UI store (theme, sidebar)
- `apps/web/src/styles/dashboard.css` — Dashboard design tokens and animations
- `apps/web/src/index.css` — Primary design tokens

## Do

- Use TanStack Query for all server data fetching
- Use TanStack Table for all data grids
- Use React Hook Form + Zod for all forms
- Use Lucide for all icons
- Use Tailwind + `var(--d-*)` tokens for all styling
- Lazy-load heavy dependencies (Recharts, CesiumJS, Deck.gl)
- Add new deps to `manualChunks` in vite.config.ts
- Check bundle size impact before adding dependencies

## Don't

- Install UI component kits (shadcn, MUI, Chakra, Ant Design)
- Replace Vite with Next.js or another framework
- Add state management beyond Zustand
- Add styling solutions beyond Tailwind + CSS custom properties
- Add icon libraries beyond Lucide
- Add animation libraries — use CSS keyframes in dashboard.css
- Duplicate functionality that @sonalit/contracts already provides
