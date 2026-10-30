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
- GET /api/v1/sjm/airspace?flight_number={flightNumber}&airport_code={IATA|ICAO} — bounded OpenSky aircraft snapshot plus independently licensed flight status, targeted ADSB.lol cross-check, aviation weather, NOTAM authority and provider-capability metadata. Both query parameters are optional. A three-letter IATA or four-letter ICAO airport code is resolved against the public-domain OurAirports CSV index; METAR/TAF requests are made only after a unique ICAO match. Ambiguous, missing or unavailable mappings do not trigger a weather request.

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

The adapter does not invent aircraft registration, origin/destination, route, airline schedule, gate, delay, cancellation or arrival messages. OpenSky's REST API does not provide commercial flight schedules or FLIFO disruption events. State vectors can identify their reported source as ADS-B, ASTERIX, MLAT or FLARM; which sources are actually present depends on OpenSky receiver coverage in the queried region. An exact callsign correlation is therefore only a correlation against a current aircraft state vector; it is not proof of passenger identity, flight schedule, arrival, handover or journey closure.

For 3D placement, only an ADS-B geometric-altitude value from position source `0` is treated as WGS-84 ellipsoid height. Other geometric altitude values remain explicitly labelled but are not assumed to share that vertical datum; barometric altitude is never used as ellipsoid height. If no trustworthy geometric height is available, the aircraft marker is placed at the ellipsoid surface while its reported altitude remains visible in the detail panel.

### Licensing and credentials

OpenSky's current Terms of Use require written permission and a licence for any for-profit/commercial entity and for any operational REST API use in a live product, service or automated system. This includes internal operational use. Feed activation is therefore blocked until the intended Sonalit commercial and operational scope, tenant display/redistribution rights and any required data-sharing restrictions are confirmed in a written agreement directly with OpenSky Network.

The authorised runtime configuration is:
- `SJM_AIRSPACE_FEED_ENABLED=true`
- `SJM_AIRSPACE_LICENSE_CONFIRMED=true` only after the written operational/commercial licence and intended tenant-display/redistribution scope have been reviewed and approved
- `OPENSKY_CLIENT_ID` and `OPENSKY_CLIENT_SECRET` as server-side secrets (OAuth2 API-client credentials, never browser credentials)
- `SJM_AIRSPACE_BOUNDS` as a bounded operational rectangle in `south west north east` order
- `OPENSKY_CREDIT_TIER=standard` (default), `active_feeder` or `licensed`, matching the actual OpenSky account entitlement; this is a deployment declaration, not an entitlement check against OpenSky
- `OPENSKY_CREDIT_WINDOW=daily` with `OPENSKY_CREDIT_BUDGET=3000` for the conservative standard-account profile; the standard authenticated allowance is 4,000 credits/day, active-feeder is up to 8,000/day, and the standard tier is capped in code at 4,000/day
- `OPENSKY_CREDIT_WINDOW=hourly` is accepted only with `OPENSKY_CREDIT_TIER=licensed`, and a budget no greater than the documented licensed-user tier of 14,400 credits/hour
- `OPENSKY_POLL_INTERVAL_SECONDS` for the desired poll interval (default 120 seconds in daily mode and 5 seconds in hourly mode; the effective interval is never shorter than the budget calculation or the five-second API time resolution)

OpenSky REST API authentication uses the OAuth2 client-credentials flow. Access tokens expire after 30 minutes and are refreshed server-side. Basic username/password authentication is not supported. API rate-limit headers are monitored; HTTP 429 responses are respected using the provider's retry-after header instead of being hammered with immediate retries.

### Quota and polling model

The documented `/states/all` credit cost is based on the bounding-box area: up to 25 square degrees costs 1 credit, up to 100 costs 2, up to 400 costs 3, and larger supported queries cost 4. The documented quotas include 4,000 credits per day for a standard authenticated user, 8,000 per day for an active feeder, and 14,400 per hour for a licensed user. SJM defaults to a 3,000-credit daily budget, caps the standard tier at 4,000/day and the active-feeder tier at 8,000/day, and permits hourly mode only when the operator explicitly declares the licensed account tier. These environment values do not prove that OpenSky has granted the entitlement; the written agreement and account scope must be independently verified. SJM calculates a minimum safe poll interval from the declared budget and configured rectangle. For the current example `-5 32 6 42` (110 square degrees), the request costs 3 credits; at 120-second polling the projected use is approximately 2,160 credits per day. A licensed hourly profile can request five-second snapshots only when the account's hourly quota is confirmed; for the same rectangle, that is approximately 2,160 credits per hour.

The adapter polls only the configured rectangle, bounds aircraft and trail history, rejects malformed/future/out-of-order positions, preserves source timestamps and freshness, and stores the current snapshot in Redis. A Redis lease elects one ingest owner across API replicas; all replicas read the same shared snapshot. If Redis is unavailable, the feed fails closed instead of opening duplicate provider queries or returning a replica-local cache. The 3D globe consumes the shared provider snapshot; it does not extrapolate trajectories between observations.

No anonymous/public API fallback, synthetic aircraft, unauthorised secondary accounts or credit-limit circumvention is permitted. OpenSky coverage varies geographically; the quality and continuity of coverage in each contracted operating region, especially East Africa, must be measured during an authorised evaluation before the feed is treated as operationally suitable.

The browser receives only the bounded, normalised state snapshot and its provenance. It never receives OAuth credentials. The OpenSky dataset's use and subsequent disclosure remain subject to the licence's restrictions. An empty view does not establish that no aircraft are present.

A provider-reported aircraft position or apparent landing never transitions the SJM lifecycle, confirms a client flight schedule, completes a stop, verifies principal custody or closes a journey. Those remain separate authorised operations with their own evidence.

### Federated providers and data authority

The airspace endpoint composes a provider registry with independently sourced records. It does not merge the providers into one authority or allow one provider's status to overwrite another provider's evidence.

**Aircraft surveillance**
- **OpenSky Network** remains the primary bounded-area state-vector source. It has its own written commercial/operational licence and account quota gates.
- **ADSB.lol** is a secondary, targeted callsign cross-check. Its API/data use ODbL 1.0 and the provider asks production integrators to contact its maintainers. It remains disabled unless production access has been discussed/approved and ODbL attribution/database obligations have been reviewed. It is not merged into the OpenSky snapshot/cache and is not treated as a second full-area coverage feed.
- **adsb.fi public endpoints are not used** for commercial Sonalit SJM. Their published terms say public open-data endpoints are for personal, non-commercial use; use would require a separate commercial agreement.
- Source agreement requires exact ICAO24/callsign plus close timestamps; a disagreement is displayed as a source discrepancy, never auto-resolved into a fabricated position. Aircraft state vectors do not establish passenger or commercial flight identity.

**Commercial flight information**
- **AeroDataBox** is the selected optional provider for airline flight number, timetable/schedule, airport departure/arrival boards, and flight status including scheduled and actual/estimated movement times where its airport coverage supports those updates. Its documentation explicitly warns that live status is not available at every airport and that coverage/quality markers must be inspected per airport. SJM preserves UTC timestamps and the provider's airport-local strings independently; the UI labels the two rather than converting an airport movement to the dispatcher's device timezone.
- The integration uses `/flights/number/{flightNumber}`; activation additionally requires the correct subscription gateway/key header, a commercial-use permission, and written confirmation that the intended customer-facing/downstream derived-work use is covered. API general-commercial-use rights and commercial B2B derived-work/sub-licensing rights are not assumed to be interchangeable.
- No AeroDataBox credential is configured by this change. With no licensed account the flight-status result is `NOT_CONFIGURED`, not an inferred timetable.
- OpenSky's historic flight endpoints can help with retrospective aircraft/airport movement research, but their batch update means they are not substituted for current airline schedule, gate, delay or cancellation feeds.

**Aviation weather**
- **AviationWeather.gov Data API** is integrated server-side for worldwide METAR and TAF observations/forecasts and the international SIGMET response. The service is not called directly from browsers (CORS is not permitted); requests use a descriptive User-Agent, a verified ICAO station code (resolved from the journey's IATA/ICAO code through OurAirports) and a five-minute application cache. Provider 204/no-data, rate-limit and outage responses remain explicit.
- Its documented service limit is 100 requests/minute and most endpoint queries return at most 400 entries. Global SIGMET results are presented as provider notices, not as route-intersection analysis or an automated threat assessment. The SJM route must not be labelled safe/unsafe from an unfiltered global list.
- The UI accepts a journey airport code as a three-letter IATA or four-letter ICAO identifier. SJM resolves the exact code against OurAirports; a unique ICAO match enables the METAR/TAF lookup, while an ambiguous or unknown code leaves the weather tile unrequested.

**Aeronautical reference and NOTAM authority**
- **OurAirports** provides public-domain airport reference data, updated nightly, but disclaims accuracy and fitness-for-use. SJM resolves exact IATA/ICAO identifiers from its `airports.csv` dataset, caches the index in each API process for 24 hours and caches provider download failures for 15 minutes. An API replica may perform its own daily refresh; this reference cache is not represented as a single shared feed. Multiple airports for one IATA code are returned as `AMBIGUOUS` and are never auto-selected. This lookup does not certify an airport, runway, station or navigation procedure.
- **open flightmaps (OFMA)** grants a royalty-free General Users License that includes commercial use, but regional coverage and quality vary, and the project states that its data is not certified for primary navigation. It is an optional supplementary aeronautical reference, not a clearance or NOTAM authority. No OFMA data is synced by this change.
- **KCAA AIM / Nairobi FIR** is the official local NOTAM and pre-flight briefing authority. KCAA says NOTAM/briefing access is granted through its online briefing request process. SJM links operators to the official AIM service; it does not scrape authenticated portals or manufacture NOTAMs.
- **EUROCONTROL MyEAD** is a candidate global system-to-system source for worldwide NOTAM and aeronautical data, subject to its Data User Agreement and any service/royalty charges. **EAD Basic is explicitly not for operational use** and is never ingested into SJM.
- No NOTAM source is marked live/available until an authorised operational data agreement or authenticated feed is implemented, tested and accepted. A missing NOTAM response is not evidence that no restrictions exist.

**Federation and product invariants**
- Each source has an independent status, timestamp, scope, licence, evidence class, error state and refresh policy. An unavailable source never becomes a blank-success tile.
- Open data is not assumed to mean unrestricted commercial reuse. ODbL/share-alike, attribution, derived-work, downstream display and retention obligations are recorded per source.
- Source datasets remain isolated in their own caches/read models where licences require it; the API response is a composed view, not an implicitly merged derivative database.
- No external feed directly changes SJM journey status, flight status, movement instructions, CPO/driver tasking, passenger custody or handover confirmation. An authorised human reviews consequential actions.
- The federated API response is not a certified flight-planning, dispatch, air-traffic-control or navigation service.

## API
## Validation
Run pnpm --filter fleetops-backend test -- --runInBand and pnpm --filter @sonalit/web typecheck. CI also checks migrations, backend integration, OpenAPI drift, browser E2E, dependency audit and container build. Preview route delivery has been verified; authenticated operator walkthrough and post-merge runtime verification remain separate release gates.
