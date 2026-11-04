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

`cds_trips.status` is constrained by the database to these 13 persisted states:

- Assignment: `created → vehicle_assigned ↔ driver_assigned → awaiting_lock → locked`
- Movement: `locked → dispatched → checkpoint | delayed | at_port | delivered`
- Delivery and closure: `at_port → delivered → lock_removed → completed → archived`
- Recovery: `checkpoint → dispatched | delayed | at_port | delivered`; `delayed → dispatched | checkpoint`
- `archived` is terminal. Departure is recorded through the dedicated `POST /trips/:id/depart` endpoint.
- Persisted status values: `created`, `vehicle_assigned`, `driver_assigned`, `awaiting_lock`, `locked`, `dispatched`, `checkpoint`, `delayed`, `at_port`, `delivered`, `lock_removed`, `completed`, `archived`.

Valid transitions defined in `TRIP_TRANSITIONS` map in `routes/cds.js`.

### Container Status

`available` → `booked` → `awaiting_pickup` → `in_transit` → `at_port` → `delivered` → `maintenance` (damage/retirement belongs to the separate `condition` column)

### Lock Status

`available` → `assigned` → `installed` → `removed` | `offline` | `maintenance` (tamper is represented by `tamper_detected` and `tamper_status`)

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
| `CDSDashboard.tsx` | Production CDS command workspace and operator navigation |
| `CDSContainerRegister.tsx` | Server-filtered equipment register, condition-aware intake and record detail |
| `CDSDataPage.tsx` | Container register and driver/transporter views |
| `CDSBookings.tsx` | Booking intake and booking management |
| `BookingManifest.tsx` | Booking manifest view |
| `store.ts` | URL-backed CDS view, drawer and toast state |
| `types.ts` | CDS TypeScript contracts aligned to persisted status constraints and analytics payload |
| `hooks.ts` | CDS query and mutation hooks |
| `api.ts` | CDS API client |
| `constants.ts` | Operator view definitions and domain status metadata |
| `components.tsx` | Shared CDS components |
| `pages.tsx` | Port, booking health, activity/custody, analytics and report views |

### CDS Views (from store.ts)

`dashboard` | `live` | `bookings` | `port` | `pulse` | `containers` | `locks` | `drivers` | `transporters` | `inbox` | `analytics` | `reports` | `settings`

### Routing

CDS routes under `authFullscreenRoute` — it has its own chrome, not AppShell:
- `/cds` → `CDSDashboard.tsx`

### Field Ops

Separate routes for yard/port teams (mobile/APK):
- `/field` → `FieldHome.tsx`
- `/field/yard` → `YardApp.tsx` (container clamp operations)
- `/field/port` → `PortApp.tsx` (container unclamp operations)


### Current production register boundaries

- The production operator route is `/cds` in `apps/web/src/router.tsx`, rendered by `apps/web/src/pages/cds/CDSDashboard.tsx`. The separate `apps/container-delivery-system` frontend is not the production `/cds` implementation; do not redirect or duplicate operator workflows there without an explicit architecture decision.
- Container inventory is a register, not a movement console. The register separates ISO 6346 freight-container identity, product equipment type/size shorthand, ownership, operational status, physical condition, recorded location and stored inspection dates.
- ISO 6346 identifier check-digit validation is enforced in the browser and backend. The registration API derives initial status from physical condition: damaged/retired intake is placed into maintenance; serviceable intake starts available. It does not accept a client-supplied movement state.
- Generic container PATCH cannot set the operational status. Booking, trip, clamp and unclamp routes remain the authoritative movement writers. Do not create a second status mutation pathway in a form or field device.
- Yard and Port applications remain separate least-privilege field workflows. Container register access is not granted to yard/port-only roles.
- The former Billing screen only marked a booking status as billed and had no invoice, tax, payment or reconciliation ledger; it is not exposed as a Billing module. Preserve historical `billed` booking data, but do not describe it as financial accounting.
- The operator Booking Health view is not the automated Client Pulse dispatch service. The activity/custody view is a timeline, not an inbound communications inbox. Keep those semantics distinct in labels and capability copy.

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
