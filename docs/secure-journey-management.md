# Secure Journey Management (SJM)

SJM is Sonalit's standalone protective-mobility and executive-journey operations domain under XD Live Surveillance at /corridor/journeys. It owns its client accounts, journey records, mission personnel, vehicle/device assignments, route assessments, evidence, communications access and client-specific reporting. It does not depend on or create a Sonalit convoy. Existing convoy associations are retained only as read-only migration history while valid same-tenant vehicles and Guardian devices are migrated directly onto each journey. Road routing includes every ordered, coordinate-backed stop using the existing multi-waypoint routing service; the current Route Safety provider is road-only. SJM rejects caller-supplied maximum-risk thresholds until a trusted per-client policy exists, so request payloads cannot weaken the Route Safety gate. The journey state machine is REQUESTED → PLANNING → ASSESSMENT_PENDING → READY_FOR_REVIEW → APPROVED → READY_TO_DEPART → IN_PROGRESS → PAUSED/EXCEPTION → ARRIVAL_PENDING_VERIFICATION → CLOSED, with explicit CANCELLED, ABORTED and ON_HOLD outcomes. Replanning invalidates prior route and approval evidence and requires a new assessment.

## Data contract
- sjm_journeys is the authoritative journey record; planned endpoints, routed geometry and route assessment are distinct fields.
- sjm_clients owns the SJM client registry independently of cargo/logistics client records. sjm_journey_assets assigns organisation-owned vehicles and Guardian devices directly to a journey. sjm_journey_legacy_links records historical convoy linkage without retaining it as an operational dependency.
- sjm_journey_stops stores ordered stops. Manual confirmation is labelled operator_confirmed and is not GPS proof.
- sjm_journey_events records operator/system events with explicit source.
- sjm_client_profiles stores a tenant-owned report timezone and controlled report sections. An STM-specific profile must be configured against the real client record; SJM does not infer identity from a name or abbreviation.
- sjm_reports persists versioned JSON snapshots so PDF/CSV downloads reproduce the same generated snapshot. Portfolio summaries are tenant-scoped rows with a nullable journey_id and immutable stored payload.

## Integrity boundaries
1. SJM-owned tables use ENABLE and FORCE ROW LEVEL SECURITY with tenant policies. APIs validate SJM client accounts, vehicles, Guardian devices and personnel against the authenticated organisation.
2. Planning calls the existing Route Safety service; no route geometry or risk score is invented.
3. Approval requires a stored assessment with routed status. Blocked/NO_GO routes, unrouted fallbacks, unknown gates and unresolved human review cannot be approved.
4. Conditional routes require written operational-controls acknowledgement. Human review requires an authorised supervisor's recorded rationale and decision. The UI cannot override blocked/NO_GO routes.
5. Start, pause, resume, exception, arrival verification, closure, cancel, abort, hold and replan are explicit state transitions. Outstanding stops require an explicit acknowledgement before arrival verification; closure requires an authorised admin/dispatcher attestation and is labelled as supervisor-attested, not GPS proof.
6. A journey cannot move directly from approval to active movement: departure readiness is explicitly acknowledged, then the dispatcher/operator starts the movement. Replanning clears stored route assessment and all approval/release acknowledgements.
7. Report telemetry comes only from latest device_locations rows for Guardian devices assigned directly to the journey. A timestamp without usable coordinates is not a live fix. Freshness uses recorded timestamps; missing, invalid or future-dated observations are UNAVAILABLE, never mocked or accepted as LIVE.
8. Planned itinerary, route analysis, operator confirmations and telemetry remain distinct evidence classes.
9. Stop coordinates are required for a road itinerary to be routed. The route result is assessed through those ordered via-points, not just the endpoints; more than 23 stops is rejected because configured providers may not accept more waypoints.
10. Client-local datetime inputs are converted using the selected IANA timezone rather than the browser timezone.

## API
- GET/POST /api/v1/sjm/clients; PUT /api/v1/sjm/clients/:id
- GET /api/v1/sjm/vehicles and /api/v1/sjm/devices
- GET/PUT /api/v1/sjm/journeys/:id/assets (direct vehicle and Guardian-device assignment)
- GET/PUT /api/v1/sjm/client-profiles/:clientId
- GET/POST /api/v1/sjm/journeys; GET/PATCH /api/v1/sjm/journeys/:id
- POST /api/v1/sjm/journeys/:id/plan, /review, /approve and /lifecycle
- PATCH /api/v1/sjm/journeys/:id/stops/:stopId/status
- POST /api/v1/sjm/journeys/:id/events and /reports (itinerary, pre-trip brief, daily travel report, SITREP, change notice, closeout after closure, final report)
- POST /api/v1/sjm/management-summary (admin/dispatcher/analyst; tenant-level persisted portfolio snapshot)
- GET /api/v1/sjm/reports/:reportId and GET /api/v1/sjm/reports/:reportId/download?format=PDF|CSV

Journey reports can be generated manually as itinerary, pre-trip brief, daily travel report, SITREP, change notice, closeout (only after recorded closure) and final reports. Each report locks and re-reads the journey inside the tenant transaction, captures its snapshot, persists the artifact and appends the report event atomically; closeout status is rechecked inside that transaction. Per-journey event totals and included event rows are separately recorded when history exceeds the 500-event cap. PDF and CSV exports obey the client profile’s optional section policy (type-specific readiness/change/closeout evidence remains intrinsic to those report types), neutralise spreadsheet formula injection and are exportable alongside PDF. Tenant-level management summaries use exact tenant status aggregates, a maximum 500-row journey register with a completeness flag, and an exact count of the latest 24 hours of recorded events while including at most 250 event rows from the same query snapshot. The report explicitly records total versus included events and whether the event register was truncated. Scope caps are stored in the report snapshot; no external delivery is performed. Optional automatic daily generation is available per client profile at a configured client-local time; it writes one persisted daily snapshot per eligible journey and local date, with an idempotency constraint and a system event. It is **disabled by default** and will only run for organisation UUIDs explicitly included in the runtime environment variable `SJM_REPORT_SCHEDULER_ORG_IDS`. This allowlist is required because the production schema has no authoritative organisation registry; the scheduler does not discover tenants through a global scan of tenant business tables. A missing or invalid allowlist leaves scheduled generation disabled. The scheduler uses `withOrg()` for every configured organisation, honours the active runtime fence, and uses only real SJM/Route Safety/device-location records. It does not email, message or externally distribute reports; external delivery requires tenant-managed recipients, delivery policy, and separate release/approval controls.


## Aviation data and live airspace

SJM's aviation layer is a 3D airspace picture, not a renamed journey map. It is independent from Guardian telemetry, the operator-entered flight-status field, airline FLIFO events and the authorised journey arrival/handover process.

The initial commercial provider adapter is FlightAware Firehose. It uses a persistent TLS 1.2+ TCP connection to `firehose.flightaware.com:1501`; the provider sends JSON Lines messages. The subscription must include the position layer (ADS-B/MLAT/radar layers as actually purchased) and any required FLIFO/arrival/departure event layers. Provider account enablement, pricing and permitted redistribution depend on the actual subscription and application scope.

Feed activation is blocked until an authorised platform operator configures all of these:

- `SJM_AIRSPACE_FEED_ENABLED=true`
- `SJM_AIRSPACE_LICENSE_CONFIRMED=true` after commercial licence and intended tenant-display/redistribution rights have been reviewed
- `FLIGHTAWARE_FIREHOSE_USERNAME` and `FLIGHTAWARE_FIREHOSE_API_KEY` as server-side secrets
- `SJM_AIRSPACE_BOUNDS` as a bounded operational rectangle in `south west north east` order (for example `-5 32 6 42` for a contracted East Africa region)

The backend owns the persistent TLS connection, JSONL parsing, reconnect/idle handling, bounded aircraft cache, freshness classification and event provenance. The browser never receives credentials. The Cesium globe plots only validated provider-observed positions and reported trail points; it does not dead-reckon aircraft between observations or claim complete coverage. When the feed is not configured, the endpoint returns `NOT_CONFIGURED` with an empty aircraft collection and the globe remains empty. It does not fall back to the OpenSky research API or show synthetic aircraft.

OpenSky is not the default commercial SJM feed: its published terms require written permission for commercial/for-profit use and for operational REST API integration. Any separately licensed OpenSky adapter must remain governed by its approved licence and scope.

A reported aircraft arrival or landing is not evidence that the principal has reached the receiving team. It must never transition the SJM lifecycle, complete a stop, verify custody or close a journey. Those remain separate authorised operations with their own evidence.

## API
## Validation
Run pnpm --filter fleetops-backend test -- --runInBand and pnpm --filter @sonalit/web typecheck. CI also checks migrations, backend integration, OpenAPI drift, browser E2E, dependency audit and container build. Preview route delivery has been verified; authenticated operator walkthrough and post-merge runtime verification remain separate release gates.
