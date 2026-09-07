# Sonalit Intelligence Centre — Architecture & Product Specification

## Mission

Transform Risk Intel from a feed-oriented feature into an evidence-backed intelligence platform for Monitoring & Alerting, security operations, convoy protection, client intelligence and travel risk.

Core lifecycle:

`COLLECT -> NORMALISE -> GEOLOCATE -> RESOLVE -> CORROBORATE -> FUSE -> ASSESS -> FORECAST -> EXPOSE -> DISSEMINATE -> LEARN`

Sonalit must distinguish **information**, **intelligence**, **assessment**, and **action**. AI never upgrades an unverified claim into fact merely because a model produced it.

## Hard principles

1. Admin-only surface. Intelligence Centre is not exposed to ordinary client accounts.
2. Evidence-first. Every material judgement resolves to observations and/or verified assessments.
3. Threat severity and intelligence confidence are separate dimensions.
4. Contradictory reporting lowers confidence rather than being silently discarded.
5. Provider failures are isolated; no single OSINT source can stop collection.
6. API/authorised collection is preferred. Public-source collection must respect provider terms, robots/access controls, rate limits and applicable law. No credential theft, bypassing access controls or covert account access.
7. Raw observations are immutable evidence; derived events and assessments are versioned.
8. Geography is first-class data: event point, region, corridor, route, polygon and country relationships are retained.
9. Every AI-generated publication is a draft until its evidence contract is satisfied and, for sensitive products, analyst review is complete.
10. Forecasts must state assumptions, confidence and invalidation triggers.

## Collection fabric

Provider classes:

- licensed/API-accessible social search and monitoring
- public news and RSS
- GDELT multilingual global news/event monitoring
- ACLED event and CAST forecast data where entitled
- ReliefWeb V2 where an approved appname is configured
- GDACS disaster events
- official government/security/transport sources
- humanitarian and NGO reporting
- aviation, maritime, weather and infrastructure sources
- Sonalit operational data: convoys, routes, client sites and incidents

Collection workers should have per-provider budgets, timeouts, backoff, circuit breakers, health metrics and independent failure domains.

GDELT is useful for high-frequency global discovery; its published documentation says the event/GKG layers cover multilingual reporting and update every 15 minutes. ACLED exposes an API and CAST endpoint; CAST provides monthly country/territory political-violence forecasts up to six months ahead. These sources remain inputs, not truth oracles.

ReliefWeb V2 requires an appname and, since 1 November 2025, the appname must be pre-approved. Sonalit must keep this configuration-driven and disable the provider cleanly when no approved appname is available.

## Social collection model

Do not build the system around brittle HTML scraping. Prefer official APIs, authorised feeds and public endpoints. X/Twitter, Facebook, Telegram, YouTube, Reddit and other platforms should each have a connector contract with:

- access mode
- legal/terms status
- rate limit
- authentication state
- query capability
- media capability
- language support
- geo precision
- freshness SLA
- deduplication strategy
- outage state

A connector failure produces a health event, not a false intelligence event.

## Observation model

An observation is a source-level fact/claim as received. It contains source, timestamps, URL/external ID, language, raw metadata, location, content hash, credibility and manipulation indicators.

Observations are immutable. Corrections create a new observation/version.

## Event fusion

Multiple observations should resolve to one event when they share sufficiently similar:

- time window
- geography
- entities
- event type
- semantic fingerprint

The event stores relationships to observations:

- supports
- contradicts
- duplicates
- context

Independent source diversity matters more than raw source count.

## Confidence model

Maintain separate scores:

- source reliability
- information credibility
- corroboration
- independence/diversity
- recency
- geo precision
- manipulation risk
- intelligence confidence

Example display:

`THREAT: HIGH | CONFIDENCE: 87% | 5 independent source clusters`

Never display a single blended number as if it explains everything.

## Risk trajectory

For every country/region/zone maintain:

- current severity
- event volume
- 24h/7d/30d change
- risk velocity
- geographic spread
- actor emergence
- lethality change
- infrastructure impact
- operational exposure
- forecast

Recommended trajectory states:

`rapidly_rising | rising | stable | volatile | falling | rapidly_falling`

## Early-warning detectors

Initial detector catalogue:

- event spike
- sustained trend
- new hotspot
- geographic spread
- new actor
- lethality shift
- frequency acceleration
- novel event type
- infrastructure degradation
- cross-domain convergence
- contradictory-report burst
- information-space acceleration
- route exposure
- country deterioration

Each detector outputs evidence and a reason code.

## Country intelligence

Country intelligence is a persistent analytical object, not a page assembled from the latest alerts.

Country profile sections:

1. Executive assessment
2. Current national risk
3. Risk trajectory
4. What changed
5. Key developments
6. Regional breakdown
7. Conflict/security environment
8. Civil unrest
9. Crime
10. Terrorism/armed-group environment
11. Political/security developments
12. Border environment
13. Transport and infrastructure
14. Natural hazards
15. Operational exposure
16. Forecasts
17. Intelligence gaps
18. Collection priorities
19. Sources/evidence
20. Analyst notes

## Publications

Publication families:

- Daily Security Intelligence Brief
- Weekly Security & Risk Outlook
- Monthly Strategic Country Assessment
- Flash Intelligence Alert
- Crisis Situation Report
- Country Security Profile
- Route Security Assessment
- Executive Intelligence Brief
- Client Intelligence Brief
- Election Security Assessment
- Protest Outlook
- Border Security Assessment
- Infrastructure Risk Assessment
- Travel Security Advisory

Daily answers **what happened**.
Weekly answers **what changed and why**.
Monthly answers **what it means and where it is going**.

Each publication stores a period, version, evidence list, map layers, confidence, status and publication timestamp.

## Premium report design

Every publication should support an interactive web version and export-ready PDF.

Required visual modules:

- executive judgement card
- threat ribbon
- confidence indicator
- change-from-previous-period indicator
- event timeline
- risk trajectory chart
- country/region map
- hotspot map
- threat-vector map
- event-density map
- affected corridors
- operational exposure panel
- key-source panel
- intelligence-gap panel
- forecast panel
- downgrade/upgrade triggers
- methodology and source notes
- classification/version/footer controls

Maps should be generated from Sonalit's own geospatial data and approved map providers rather than copied/scraped proprietary map imagery.

## Travel advisory engine

Inputs:

- country
- destination
- traveller profile
- trip purpose
- duration
- transport mode
- itinerary/route

Profiles:

- general traveller
- executive
- NGO/field team
- logistics crew
- journalist
- family/tourist
- diplomatic/security personnel
- convoy/driver

Output sections:

- overall advisory level
- executive summary
- areas of concern
- areas to avoid where evidence supports it
- transport/road environment
- civil unrest
- crime
- terrorism/armed conflict
- natural hazards
- border/entry environment
- emergency considerations
- recommended security posture
- evidence and confidence
- validity period
- last major change

The generator creates a draft and attaches the evidence used. Sensitive/high-impact claims require review before publication.

## Intelligence requirements

ICRs turn passive monitoring into tasked collection.

Example:

`ICR-0241 — Determine whether protest activity is likely to disrupt the Northern Corridor within 72 hours.`

The requirement tracks status, collection scope, evidence, answer, priority and due time.

## Intelligence gaps

The system explicitly records unknowns:

- missing observation
- stale observation
- unresolved contradiction
- poor geolocation
- missing independent source
- unavailable provider

Each gap gets priority and a recommended collection action.

## Storylines

A storyline groups events into a chronological intelligence narrative.

Example:

`Initial protest signal -> mobilisation -> security deployment -> road disruption -> corroboration -> assessment upgrade -> operational exposure -> mitigation.`

Storylines support handover, investigations, client briefings and after-action review.

## Intelligence replay

A time slider reconstructs how an environment changed over a selected period. Events, risk zones, forecasts, routes and operational exposure are rendered chronologically.

## Operational exposure

Join intelligence geography to:

- active convoys
- planned routes
- vehicles
- clients
- client sites
- borders
- ports
- airports
- corridors

Output:

`Threat -> geography -> infrastructure -> operation -> exposure -> recommendation`

This is Sonalit's differentiator: intelligence directly informs operational decisions.

## AI architecture

Use open-source models where practical for classification, entity extraction, multilingual translation, clustering and local summarisation. Use stronger hosted models only for tasks where quality justifies the cost and where policy/configuration permits.

AI must operate through structured tools and evidence retrieval. It must not invent sources, locations, event dates, casualty figures or confidence.

Every AI assessment records:

- model identifier
- prompt/template version
- retrieval timestamp
- evidence IDs
- generation timestamp
- output status
- reviewer status

## Intelligence interoperability

Use a Sonalit-native intelligence object model. Add STIX-compatible mappings for objects that benefit from interoperability; do not force non-cyber operational intelligence into a cyber-only ontology. STIX 2.1 defines a structured threat/observable representation and TAXII 2.1 defines an exchange protocol; both are useful reference standards for future federation/export.

## Governance

Admin-only UI and API enforcement.

Audit every:

- source configuration change
- event merge/split
- severity override
- confidence override
- assessment approval
- publication
- advisory publication
- source disablement
- analyst feedback

Sensitive publication products require reviewer state before external dissemination.

## Quality metrics

Monitor:

- source uptime
- collection latency
- event detection latency
- corroboration rate
- false-positive rate
- contradiction rate
- analyst override rate
- forecast accuracy
- missed-event rate
- unsupported-claim rate
- publication freshness
- intelligence-gap ageing

## UI information architecture

`INTELLIGENCE`

- Global Picture
- Fresh Event Radar
- Live OSINT
- Events
- Threat Map
- Country Intelligence
- Regional Intelligence
- Watchlists
- Intelligence Requirements
- Intelligence Gaps
- Investigations
- Storylines
- Forecasts
- Operational Exposure
- Travel Advisories
- Reports & Publications
- Intelligence Copilot
- Source Intelligence
- Collection Management
- Intelligence Quality

## Delivery sequence

### Phase 1 — Foundation

- database model
- source registry
- immutable observations
- fused events
- confidence engine
- country aggregation
- publication/advisory/ICR/watchlist schemas
- admin-only API surface

### Phase 2 — Collection Fabric

- provider registry
- X/social authorised connectors
- news/RSS expansion
- Telegram public-source pipeline
- YouTube/Reddit where authorised
- official-source connectors
- source health dashboard

### Phase 3 — Fusion & Early Warning

- entity resolution
- event clustering
- contradiction engine
- source independence
- detector catalogue
- risk velocity
- country trajectory
- early warning rules

### Phase 4 — Intelligence Products

- country intelligence page
- daily/weekly/monthly generation
- publication workflow
- maps and diagrams
- travel advisory engine
- evidence explorer

### Phase 5 — Operations Bridge

- route exposure
- convoy exposure
- client exposure
- route threat projection
- mitigation recommendations

### Phase 6 — Predictive & Learning

- scenario engine
- forecast validation
- analyst feedback loop
- intelligence replay
- intelligence gaps/collection tasking
- executive/global intelligence picture

## Acceptance criteria

The system is not considered production-grade merely because it can collect articles.

A production intelligence event must be:

1. traceable to one or more observations;
2. geographically resolved where possible;
3. timestamped;
4. classified with a reason;
5. confidence-scored independently from severity;
6. deduplicated/fused where appropriate;
7. contradiction-aware;
8. linked to its evidence;
9. available for country/region aggregation;
10. capable of triggering early-warning and operational-exposure analysis;
11. auditable;
12. safe to publish only after the required review state.
