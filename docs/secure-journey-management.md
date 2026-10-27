# Secure Journey Management (SJM)

SJM is the itinerary, approval, lifecycle and client-specific reporting workbench under XD Live Surveillance at /corridor/journeys. It reuses tenant-scoped client and convoy records, Sonalit Route Safety, and actual device-location evidence.

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
5. Start, complete and cancel are explicit state transitions. Completing with outstanding stops requires acknowledgement.
6. Report telemetry comes only from latest device_locations rows for convoy-linked devices. Freshness uses recorded timestamps; missing data is UNAVAILABLE, never mocked.
7. Planned itinerary, route analysis, operator confirmations and telemetry remain distinct evidence classes.

## API
- GET /api/v1/sjm/clients and /convoys
- GET/PUT /api/v1/sjm/client-profiles/:clientId
- GET/POST /api/v1/sjm/journeys; GET/PATCH /api/v1/sjm/journeys/:id
- POST /api/v1/sjm/journeys/:id/plan, /review, /approve and /lifecycle
- PATCH /api/v1/sjm/journeys/:id/stops/:stopId/status
- POST /api/v1/sjm/journeys/:id/events and /reports
- GET /api/v1/sjm/reports/:reportId and GET /api/v1/sjm/reports/:reportId/download?format=PDF|CSV

Daily reports can be generated for the configured client-local date and exported as PDF/CSV. This first implementation does not auto-email or schedule distribution. That requires tenant-managed recipients, delivery policy and release/approval controls. Report generation is authenticated and persists a snapshot; automatic delivery is not implied.

## Validation
Run pnpm --filter fleetops-backend test -- --runInBand and pnpm --filter @sonalit/web typecheck. Full CI and preview visual QA must pass before merge. Migration, deployment and real-user workflows need post-merge verification.
