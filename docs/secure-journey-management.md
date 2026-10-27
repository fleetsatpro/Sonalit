# Secure Journey Management (SJM)

SJM is the itinerary, approval, lifecycle and client-specific reporting workbench under XD Live Surveillance at /corridor/journeys. It reuses tenant-scoped client and convoy records, Sonalit Route Safety, and actual device-location evidence. Road routing includes every ordered, coordinate-backed stop using the existing multi-waypoint routing service; the current Route Safety provider is road-only. The journey state machine is REQUESTED → PLANNING → ASSESSMENT_PENDING → READY_FOR_REVIEW → APPROVED → READY_TO_DEPART → IN_PROGRESS → PAUSED/EXCEPTION → ARRIVAL_PENDING_VERIFICATION → CLOSED, with explicit CANCELLED, ABORTED and ON_HOLD outcomes. Replanning invalidates prior route and approval evidence and requires a new assessment.

## Data contract
- sjm_journeys is the authoritative journey record; planned endpoints, routed geometry and route assessment are distinct fields.
- sjm_journey_stops stores ordered stops. Manual confirmation is labelled operator_confirmed and is not GPS proof.
- sjm_journey_events records operator/system events with explicit source.
- sjm_client_profiles stores a tenant-owned report timezone and controlled report sections. An STM-specific profile must be configured against the real client record; SJM does not infer identity from a name or abbreviation.
- sjm_reports persists versioned JSON snapshots so PDF/CSV downloads reproduce the same generated snapshot.

## Integrity boundaries
1. All SJM tables use ENABLE and FORCE ROW LEVEL SECURITY with tenant policies. APIs validate client and convoy ownership.
2. Planning calls the existing Route Safety service; no route geometry or risk score is invented.
3. Approval requires a stored assessment with routed status. Blocked/NO_GO routes, unrouted fallbacks, unknown gates and unresolved human review cannot be approved.
4. Conditional routes require written operational-controls acknowledgement. Human review requires an authorised supervisor's recorded rationale and decision. The UI cannot override blocked/NO_GO routes.
5. Start, pause, resume, exception, arrival verification, closure, cancel, abort, hold and replan are explicit state transitions. Outstanding stops require an explicit acknowledgement before arrival verification; closure requires an authorised admin/dispatcher attestation and is labelled as supervisor-attested, not GPS proof.
6. A journey cannot move directly from approval to active movement: departure readiness is explicitly acknowledged, then the dispatcher/operator starts the movement. Replanning clears stored route assessment and all approval/release acknowledgements.
7. Report telemetry comes only from latest device_locations rows for convoy-linked devices. Freshness uses recorded timestamps; missing data is UNAVAILABLE, never mocked.
8. Planned itinerary, route analysis, operator confirmations and telemetry remain distinct evidence classes.
9. Stop coordinates are required for a road itinerary to be routed. The route result is assessed through those ordered via-points, not just the endpoints; more than 23 stops is rejected because configured providers may not accept more waypoints.
10. Client-local datetime inputs are converted using the selected IANA timezone rather than the browser timezone.

## API
- GET /api/v1/sjm/clients and /convoys
- GET/PUT /api/v1/sjm/client-profiles/:clientId
- GET/POST /api/v1/sjm/journeys; GET/PATCH /api/v1/sjm/journeys/:id
- POST /api/v1/sjm/journeys/:id/plan, /review, /approve and /lifecycle
- PATCH /api/v1/sjm/journeys/:id/stops/:stopId/status
- POST /api/v1/sjm/journeys/:id/events and /reports
- GET /api/v1/sjm/reports/:reportId and GET /api/v1/sjm/reports/:reportId/download?format=PDF|CSV

Daily reports can be generated manually and exported as PDF/CSV. Optional automatic daily generation is available per client profile at a configured client-local time; it writes one persisted daily snapshot per eligible journey and local date, with an idempotency constraint and a system event. It is **disabled by default** and will only run for organisation UUIDs explicitly included in the runtime environment variable `SJM_REPORT_SCHEDULER_ORG_IDS`. This allowlist is required because the production schema has no authoritative organisation registry; the scheduler does not discover tenants through a global scan of tenant business tables. A missing or invalid allowlist leaves scheduled generation disabled. The scheduler uses `withOrg()` for every configured organisation, honours the active runtime fence, and uses only real SJM/Route Safety/device-location records. It does not email, message or externally distribute reports; external delivery requires tenant-managed recipients, delivery policy, and separate release/approval controls.

## Validation
Run pnpm --filter fleetops-backend test -- --runInBand and pnpm --filter @sonalit/web typecheck. Full CI and preview visual QA must pass before merge. Migration, deployment and real-user workflows need post-merge verification.
