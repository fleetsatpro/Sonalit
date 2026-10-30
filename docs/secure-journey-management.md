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

SJM's aviation layer uses the OpenSky Network REST API as its preferred aircraft-state source. It is independent from Guardian telemetry, operator-entered airline status, commercial flight-information services, and the authorised journey arrival/handover process.

### Provider contract and operating limits

OpenSky `GET /states/all` returns bounded state-vector snapshots, not a continuous TCP/WebSocket transponder stream. Authenticated REST state vectors have five-second time resolution; the service therefore polls a contracted geographic rectangle and shares the latest validated snapshot across SJM API replicas. The initial default is a 120-second polling interval. The adapter raises that interval when the configured geographic query cost and daily credit budget require it.

OpenSky state-vector fields used by SJM are:
- ICAO24 address, callsign and origin-country inference;
- WGS-84 latitude/longitude, position timestamp and last-contact timestamp;
- barometric altitude and geometric altitude (where provided), ground speed, true track, vertical rate and on-ground state;
- squawk, source type and aircraft category when present.

The adapter does not invent aircraft registration, origin/destination, route, airline schedule, gate, delay, cancellation or arrival messages. OpenSky's REST API does not provide commercial flight schedules or FLIFO disruption events, and its REST state-vector endpoint does not provide MLAT position vectors. An exact callsign correlation is therefore only a correlation against a current aircraft state vector; it is not proof of passenger identity, flight schedule, arrival, handover or journey closure.

For 3D placement, only an ADS-B geometric-altitude value from position source `0` is treated as WGS-84 ellipsoid height. Other geometric altitude values remain explicitly labelled but are not assumed to share that vertical datum; barometric altitude is never used as ellipsoid height. If no trustworthy geometric height is available, the aircraft marker is placed at the ellipsoid surface while its reported altitude remains visible in the detail panel.

### Licensing and credentials

OpenSky's current Terms of Use require written permission and a licence for any for-profit/commercial entity and for any operational REST API use in a live product, service or automated system. This includes internal operational use. Feed activation is therefore blocked until the intended Sonalit commercial and operational scope, tenant display/redistribution rights and any required data-sharing restrictions are confirmed in a written agreement directly with OpenSky Network.

The authorised runtime configuration is:
- `SJM_AIRSPACE_FEED_ENABLED=true`
- `SJM_AIRSPACE_LICENSE_CONFIRMED=true` only after the written operational/commercial licence and intended tenant-display/redistribution scope have been reviewed and approved
- `OPENSKY_CLIENT_ID` and `OPENSKY_CLIENT_SECRET` as server-side secrets (OAuth2 API-client credentials, never browser credentials)
- `SJM_AIRSPACE_BOUNDS` as a bounded operational rectangle in `south west north east` order
- `OPENSKY_CREDIT_WINDOW=daily` with `OPENSKY_CREDIT_BUDGET=3000` for the conservative standard-account profile; the standard authenticated allowance is documented as 4,000 credits per day and active-feeder accounts may receive 8,000 per day
- `OPENSKY_CREDIT_WINDOW=hourly` with a budget no greater than the documented licensed-user tier of 14,400 credits per hour, only after the account entitlement has been confirmed
- `OPENSKY_POLL_INTERVAL_SECONDS` for the desired poll interval (default 120 seconds in daily mode and 5 seconds in hourly mode; the effective interval is never shorter than the budget calculation or the five-second API time resolution)

OpenSky REST API authentication uses the OAuth2 client-credentials flow. Access tokens expire after 30 minutes and are refreshed server-side. Basic username/password authentication is not supported. API rate-limit headers are monitored; HTTP 429 responses are respected using the provider's retry-after header instead of being hammered with immediate retries.

### Quota and polling model

The documented `/states/all` credit cost is based on the bounding-box area: up to 25 square degrees costs 1 credit, up to 100 costs 2, up to 400 costs 3, and larger supported queries cost 4. The documented quotas include 4,000 credits per day for a standard authenticated user, 8,000 per day for an active feeder, and 14,400 per hour for a licensed user. SJM defaults to a 3,000-credit daily budget and calculates a minimum safe poll interval from that budget and the configured rectangle. For the current example `-5 32 6 42` (110 square degrees), the request costs 3 credits; at 120-second polling the projected use is approximately 2,160 credits per day. A licensed hourly profile can request five-second snapshots only when the account's hourly quota is confirmed; for the same rectangle, that is approximately 2,160 credits per hour.

The adapter polls only the configured rectangle, bounds aircraft and trail history, rejects malformed/future/out-of-order positions, preserves source timestamps and freshness, and stores the current snapshot in Redis. A Redis lease elects one ingest owner across API replicas; all replicas read the same shared snapshot. If Redis is unavailable, the feed fails closed instead of opening duplicate provider queries or returning a replica-local cache. The 3D globe consumes the shared provider snapshot; it does not extrapolate trajectories between observations.

No anonymous/public API fallback, synthetic aircraft, unauthorised secondary accounts or credit-limit circumvention is permitted. OpenSky coverage varies geographically; the quality and continuity of coverage in each contracted operating region, especially East Africa, must be measured during an authorised evaluation before the feed is treated as operationally suitable.

The browser receives only the bounded, normalised state snapshot and its provenance. It never receives OAuth credentials. The OpenSky dataset's use and subsequent disclosure remain subject to the licence's restrictions. An empty view does not establish that no aircraft are present.

A provider-reported aircraft position or apparent landing never transitions the SJM lifecycle, confirms a client flight schedule, completes a stop, verifies principal custody or closes a journey. Those remain separate authorised operations with their own evidence.

## API
## Validation
Run pnpm --filter fleetops-backend test -- --runInBand and pnpm --filter @sonalit/web typecheck. CI also checks migrations, backend integration, OpenAPI drift, browser E2E, dependency audit and container build. Preview route delivery has been verified; authenticated operator walkthrough and post-merge runtime verification remain separate release gates.
