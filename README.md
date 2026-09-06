# Sonalit

Sonalit is a containerised logistics platform focused on container tracking, bookings and e-lock management. This repository contains a full-stack monorepo with web UIs, APIs, and services.

## Quick start (development)

1. Install dependencies

   pnpm install

2. Start the web app

   cd apps/web
   pnpm dev

3. Open http://localhost:3000 and use the sidebar to navigate to the Container Management (CDS) section.

---

## CDS — Container Management

The CDS (Container Data System) is the sub-app inside the web frontend used to manage containers, drivers, transporters, bookings and related operational views.

Location

- apps/web/src/pages/cds — the CDS pages and views

Key files

- apps/web/src/pages/cds/CDSDashboard.tsx — main CDS UI (sidebar, header, dashboard, live map and view router)
- apps/web/src/pages/cds/CDSDataPage.tsx — data views for Containers, Drivers, Transporters and Bookings
- apps/web/src/pages/cds/components.js — shared UI primitives used by the CDS pages (DataTable, DrawerField, StatusBadge, FilterChip, KPICard, CDSDrawer, CDSToastContainer, etc.)
- apps/web/src/pages/cds/hooks.js — data hooks (useContainers, useCDSDrivers, useCDSTransporters, useDashboardKPIs, useActivity, useTrips)
- apps/web/src/pages/cds/store.js — lightweight UI store for active view / drawer state
- apps/web/src/pages/cds/constants.js — CDS view definitions (CDS_VIEWS) used to build the rail/sidebar

Running the CDS locally

1. Start the web app (see Quick start above).
2. Open the web UI and click the truck icon then navigate to the Container Management (CDS) section in the left rail.
3. The Dashboard provides a Live Map, KPIs and Recent Activity. Use the "Live" and "Containers" views for real-time fleet and container lists.

Developer notes

- Views and navigation: CDSDashboard imports CDS_VIEWS from `constants.js` and maps view ids to components. To add a new CDS view:
  - Add an entry to `CDS_VIEWS` in `constants.js` with an `id`, `label` and `sub` text.
  - Add the component import to `CDSDashboard.tsx` and include it in the main render switch (the list of `activeView === '...'` checks).
  - Add an icon to `VIEW_ICONS` mapping in `CDSDashboard.tsx`.

- Data tables & drawers: `CDSDataPage.tsx` contains the table layouts and drawer detail views for Containers, Drivers and Transporters. Data access is provided by hooks in `hooks.js`. Mantain the `keyExtractor` and `searchable` props on `DataTable` components for consistent behaviour.

- State & drawer: The `useCDSStore()` hook exposes `activeView` and `openDrawer` utilities used across the CDS app. Use `openDrawer(title, content)` to show the standard right-side drawer for item details.

- Styling & tokens: The CDS pages use shared CSS variables and tailwind-like utility classes. Keep UI snippets compact and prefer small, focused components for new fields.

- Tests & linting: Run the same monorepo test/lint commands when changing CDS code:

  pnpm lint
  pnpm test

Useful links

- CDS dashboard source: apps/web/src/pages/cds/CDSDashboard.tsx
- CDS data views: apps/web/src/pages/cds/CDSDataPage.tsx

---

## Repo layout (short)

- apps/web — React/TypeScript web application (dashboard, CDS sub-app)
- apps/api — backend services (if present)
- packages/* — shared libraries and components

## Contributing

- Fork the repo and submit PRs against the default branch.
- Run linters and tests before opening a PR.

## License

Add license info here (e.g., MIT).

---

Copyright © Sonalit.
