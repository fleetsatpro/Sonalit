---
name: cds-container-delivery
description: Container Delivery System — first-class sub-application with its own schema, trip state machine, e-lock integration, AI extraction, and field ops.
triggers:
  - CDS
  - container
  - booking
  - e-lock
  - electronic lock
  - SecuriSat
  - clamp
  - unclamp
  - yard
  - port
  - shipment
  - trip
  - transporter
  - container delivery
related_skills:
  - multi-tenancy
  - realtime-events
  - auth-security
  - frontend-patterns
  - testing
---

# CDS — Container Delivery System

## Purpose

Teaches the Container Delivery System, a first-class sub-application within Sonalit. CDS has its own database schema (18+ tables with `cds_` prefix), its own frontend sub-app with dedicated chrome, and its own AI-powered operations intelligence.

## When to Activate

Any work involving containers, bookings, e-locks, trips, transporters, yard/port operations, or CDS-specific pages.

## Database Schema

Migration: `backend/migrations/20260805_073_cds_schema.sql`

All `cds_*` tables have RLS enabled with the standard `org_id` + `current_setting('app.current_org_id')` policy.

### Core Tables

| Table | Purpose |
|-------|---------|
| `cds_customers` | Cargo owners/shippers |
| `cds_transporters` | Transport companies |
| `cds_vehicles` | Transport vehicles (registration, type, capacity) |
| `cds_drivers` | CDS-specific drivers (separate from fleet drivers) |
| `cds_containers` | Container inventory (number, ISO type, size, weight, condition, status) |
| `cds_electronic_locks` | SecuriSat e-locks (serial, provider, firmware, battery, status) |
| `cds_lock_events` | Lock events (lock/unlock/tamper, with lat/lng) |
| `cds_bookings` | Customer bookings (booking_number, ETA, commodity, pickup/delivery) |
| `cds_booking_containers` | Booking-to-container assignments |
| `cds_trips` | The main operational entity — see state machine below |
| `cds_trip_events` | Trip event log |
| `cds_gps_history` | GPS tracking (partitioned by month) |
| `cds_geofences` | CDS-specific geofences |
| `cds_alerts` | CDS alerts (AI-generated and manual) |
| `cds_incidents` | CDS incidents |
| `cds_documents` | Documents with AI extraction fields |
| `cds_notifications` | CDS notifications |
| `cds_audit_logs` | CDS audit trail |
| `cds_activity_feed` | Activity timeline |
| `cds_reports` | CDS reports |

### Trip State Machine

`cds_trips.status` follows this state machine (23 states):

```
created → customer_assigned → container_assigned → vehicle_assigned →
driver_assigned → awaiting_lock → locked → lock_assigned →
tracking_active → dispatched → in_transit → checkpoint | delayed |
border_crossing | at_port → arrived → unlock_authorized → delivered →
lock_removed → completed → container_returned → closed → archived
```

Valid transitions defined in `TRIP_TRANSITIONS` map in `routes/cds.js`.

### Container Status

`available` → `assigned` → `in_transit` → `at_port` → `delivered` → `maintenance` | `damaged` | `retired`

### Lock Status

`available` → `assigned` → `locked` → `unlocked` | `offline` | `tampered` | `maintenance`

## Backend API

File: `backend/src/routes/cds.js`

Uses generic CRUD helpers: `listRows()`, `getRow()`, `createRow()`, `updateRow()`.

Code generation pattern: `genCode(prefix)` produces codes like `CDS-<timestamp36>-<random>`, `BK-...`, etc.

All CDS routes use `authenticate` + `attachOrgDb` + `org_scope_required` guard.

### CDS Intelligence (AI)

File: `backend/src/utils/cdsIntelligence.js`

- Runs every 15 minutes via cron
- Uses Groq/Llama 3.3 70B (not Anthropic)
- Gathers live snapshot: active trips, pending bookings, container inventory, unacknowledged alerts
- Detects: overdue trips, stalled trips, missing container assignments, high-risk trips, ETA breaches, capacity gaps
- Writes to `cds_alerts` with deduplication (2-hour window)
- Alert types: `overdue_trip`, `stalled_trip`, `missing_containers`, `high_risk`, `eta_breach`, `capacity_gap`, `anomaly`

### Booking Extraction (AI)

File: `backend/src/utils/extractionClient.js`

AI-powered extraction of booking data from uploaded documents.

## Frontend Sub-App

The CDS frontend is a self-contained sub-app under `apps/web/src/pages/cds/`.

### Files

| File | Purpose |
|------|---------|
| `CDSDashboard.tsx` | Main CDS dashboard with KPIs and overview |
| `CDSDataPage.tsx` | Data management pages |
| `CDSBookings.tsx` | Booking management |
| `BookingManifest.tsx` | Booking manifest view |
| `CDSIntro.tsx`, `CDSIntroScene.tsx` | Onboarding/intro |
| `store.ts` | Zustand store (CDSView, drawer, toasts, viewMode) |
| `types.ts` | All CDS TypeScript types (23 ShipmentStatus, 8 ContainerStatus, 7 LockStatus) |
| `hooks.ts` | CDS data hooks |
| `api.ts` | CDS API client |
| `constants.ts` | CDS constants |
| `components.tsx` | Shared CDS components |
| `pages.tsx` | Sub-page components |

### CDS Views (from store.ts)

`dashboard` | `live` | `containers` | `bookings` | `locks` | `drivers` | `transporters` | `port` | `pulse` | `inbox` | `billing` | `reports` | `analytics` | `settings`

### Routing

CDS routes under `authFullscreenRoute` — it has its own chrome, not AppShell:
- `/cds` → `CDSDashboard.tsx`

### Field Ops

Separate routes for yard/port teams (mobile/APK):
- `/field` → `FieldHome.tsx`
- `/field/yard` → `YardApp.tsx` (container clamp operations)
- `/field/port` → `PortApp.tsx` (container unclamp operations)

## Dashboard KPIs

`active_containers`, `in_transit`, `delivered_today`, `active_locks`, `locks_removed`, `pending_unclamp`, `delayed_trips`, `avg_transit_hours`

## Relevant Files

- `backend/migrations/20260805_073_cds_schema.sql` — full CDS schema
- `backend/src/routes/cds.js` — CDS API routes
- `backend/src/utils/cdsIntelligence.js` — AI operations monitoring
- `backend/src/utils/extractionClient.js` — document extraction
- `apps/web/src/pages/cds/` — entire CDS frontend sub-app
- `apps/web/src/pages/field/` — yard/port field ops

## Do

- Treat CDS as a separate domain — keep CDS code in CDS files
- Use `cds_` prefix for all CDS tables
- Follow the trip state machine transitions exactly
- Add RLS to any new CDS table
- Keep CDS frontend state in `pages/cds/store.ts`

## Don't

- Mix CDS entities with core fleet entities
- Skip the state machine — don't allow arbitrary trip status changes
- Create CDS tables without the `cds_` prefix
- Put CDS-specific components outside `pages/cds/`
- Modify the AI intelligence interval without understanding alert deduplication
