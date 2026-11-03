---
name: portal-system
description: Cargo owner portal — portal token auth, magic-link clients, custody chain (SHA-256 hash chain), POD, portal sanitiser security boundary, and 14 portal frontend pages.
triggers:
  - portal
  - cargo owner
  - custody
  - proof of delivery
  - POD
  - client
  - magic link
  - portal token
related_skills:
  - auth-security
  - convoy-system
  - multi-tenancy
  - realtime-events
  - frontend-patterns
---

# Portal System

## Purpose

Teaches the cargo owner portal — a separate-auth-domain frontend that gives cargo clients visibility into their convoy without exposing internal operations. The portal has its own auth model, its own security boundary (portalSanitiser), and its own visual identity.

## When to Activate

Any work involving portal pages, portal tokens, client accounts, custody chain, proof of delivery, or cargo owner-facing features.

## Two Auth Models

### 1. Portal Token (SHA-256 bearer)

File: `backend/src/middleware/portalAuth.js`

Admin/dispatcher issues a token per convoy via `POST /api/v1/portal/tokens`. Token is SHA-256 hashed before storage. Client presents the raw token as `Authorization: Bearer <token>`.

`portalAuth` middleware: hashes the presented token, looks up in `portal_tokens` table, attaches `req.portal` with `{ convoy_id, cargo_owner_ref, org_id }`. Token is scoped to exactly one convoy.

Admin endpoints: `POST /tokens` (issue), `GET /tokens` (list), `DELETE /tokens/:id` (revoke).

### 2. Magic-Link Client Auth

File: `backend/src/middleware/clientAuth.js`

Cargo clients with email-based accounts use magic-link login (`POST /api/v1/portal/auth/magic-link`). Receives a session JWT scoped to the client's linked convoy IDs.

`clientAuth` middleware: verifies client JWT, attaches `req.client` with `{ id, email, org_id, convoy_ids }`.

Access guard `checkAccess(client, convoy_id, res)`: returns 403 if convoy not in client's link set.

## Portal Sanitiser — Security Boundary

File: `backend/src/utils/portalSanitiser.js`

**NEVER expose to portal**: raw alert messages, crew names (beyond assigned CFO), exact tactics, law-enforcement specifics, vehicle IDs, or other clients' convoy data.

### Alert Type Mapping

Internal → Portal: `speed`→`delay`, `geofence`→`deviation`, `mechanical`→`unplanned_stop`, `security`→`sos`, `communication`→`delay`

### Severity Mapping

Internal → Portal: `low`→`info`, `medium`→`warning`, `high`→`critical`, `critical`→`critical`

### Safe Summaries

Each portal alert type has three severity-graded summaries (critical/warning/info) that describe the situation without leaking operational details.

Example: Internal "geofence breach — vehicle KBC 123F deviated 2.3km from corridor" becomes portal "Vehicle route deviation confirmed. Escort responding. Cargo status secure."

### Portal Security Level

`deriveLevel(incidents)` → `critical` | `warning` | `secure`

`buildSecurityStatus()` produces headline + detail for the portal security dashboard.

### Timeline Builder

`buildTimeline()` creates a sanitised event timeline: `detected` → `responding` → `resolved`

## Custody Chain

File: `backend/src/utils/custodyPdfGenerator.js`, `backend/src/routes/portalCustody.js`

SHA-256 hash chain for custody events. Each event's hash includes the previous event's hash, creating a tamper-evident chain. `SELECT...FOR UPDATE` prevents chain splits.

PDF generation: pdfkit-based, matching Sonalit brand colours (dark navy, orange accent).

## Proof of Delivery (POD)

File: `backend/src/routes/portalConvoy.js`

Table: `proof_of_delivery`

Columns: `convoy_id`, `shipment_id`, `delivered_at`, `recipient_name`, `signature_url`, `photo_urls`, `location_lat/lng`, `notes`, `pod_pdf_url`

Operators create POD records; clients view them through portal auth.

## Backend Route Files

| File | Auth | Purpose |
|------|------|---------|
| `routes/portal.js` | Portal token | Convoy status, trail, custody PDF |
| `routes/portalAuth.js` | Public/Client | Magic-link login, session management |
| `routes/portalClients.js` | JWT (admin) | Client account CRUD |
| `routes/portalConvoy.js` | Client JWT | POD, exceptions, documents, sensors, replay, notifications |
| `routes/portalCustody.js` | Client JWT | Custody chain events |
| `routes/portalSecurity.js` | Client JWT | Security status, incidents |

## Frontend Portal Pages

Directory: `apps/web/src/pages/portal/`

14 pages under `portalRootRoute` (PortalLayout shell):

| Page | Purpose |
|------|---------|
| `PortalLogin.tsx` | Magic-link login |
| `PortalDashboard.tsx` | Client dashboard |
| `PortalConvoy.tsx` | Convoy detail view |
| `PortalTrack.tsx` | Live tracking map |
| `PortalCustody.tsx` | Custody chain viewer |
| `PortalPOD.tsx` | Proof of delivery |
| `PortalDocuments.tsx` | Convoy documents |
| `PortalManifest.tsx` | Booking manifest |
| `PortalExceptions.tsx` | Exception events |
| `PortalSecurity.tsx` | Security status |
| `PortalSensors.tsx` | Sensor data |
| `PortalReplay.tsx` | Trip replay |
| `PortalNotifications.tsx` | Client notifications |
| `PortalLayout.tsx` | Portal shell/chrome |

## Realtime

Centrifugo channel: `portal#<convoyId>` — portal-specific live updates, separate from internal org channel.

CSRF: portal routes are in the CSRF skip list (`/api/v1/portal/`).

## Relevant Files

- `backend/src/routes/portal.js` — portal token convoy endpoints
- `backend/src/routes/portalAuth.js` — magic-link auth
- `backend/src/routes/portalClients.js` — client account management
- `backend/src/routes/portalConvoy.js` — POD, documents, sensors, replay
- `backend/src/routes/portalCustody.js` — custody chain
- `backend/src/routes/portalSecurity.js` — security status
- `backend/src/middleware/portalAuth.js` — portal token middleware
- `backend/src/middleware/clientAuth.js` — client JWT middleware
- `backend/src/utils/portalSanitiser.js` — security boundary
- `backend/src/utils/custodyPdfGenerator.js` — custody chain PDF
- `apps/web/src/pages/portal/` — 14 portal frontend pages

## Do

- Always sanitise internal data through `portalSanitiser` before exposing to portal
- Use `portalAuth` for token-based convoy access, `clientAuth` for magic-link sessions
- Check `checkAccess()` on every client-auth endpoint
- Keep portal channels (`portal#<convoyId>`) separate from org channels
- Maintain the custody hash chain integrity (SELECT...FOR UPDATE)

## Don't

- Expose raw alert messages, vehicle IDs, or crew names to portal clients
- Skip the portalSanitiser — it IS the security boundary
- Allow cross-convoy data access in client endpoints
- Mix portal auth middleware with internal JWT auth on the same route
- Break the custody chain by inserting events without the previous hash
