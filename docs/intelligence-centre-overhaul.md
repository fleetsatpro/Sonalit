# Sonalit Intelligence Centre — Overhaul

## Product intent
The Intelligence Centre is a restricted, tenant-scoped intelligence production environment, not a generic news dashboard. Its operating cycle is **Collect → preserve provenance → fuse → investigate → assess → warn → disseminate**.

The six workspaces are Command Picture, Analysis Workbench, Incident Fabric, Newsroom, Collection Control and Publications. One shell owns navigation, access posture, time context and module identity. Historical `?module=core` links continue to resolve to the Analysis Workbench.

## Research translated into product principles
- **Geospatial command picture:** map layers, selectable objects, linked overlays, search and temporal controls belong in one connected analytic surface—not a decorative map. Palantir documents these as interacting map capabilities: https://www.palantir.com/docs/foundry/map/overview/ and https://www.palantir.com/docs/foundry/map/timeline/
- **Investigation-first records:** event/subject records are starting points for investigation, with linked evidence and entity relationships. Recorded Future describes Intelligence Cards as triage and investigation pivots and the Intelligence Graph as a relationship-exploration surface: https://www.recordedfuture.com/platform/intelligence-cards and https://www.recordedfuture.com/platform/intelligence-graph
- **Analytic integrity:** source evaluation, uncertainty, assumptions and alternative explanations must remain explicit. Keyword matches are not severity judgements. This follows objectivity and analytic-tradecraft principles in ICD 203: https://www.dni.gov/files/ODNI/documents/ICD/ICD-203.pdf
- **Threat triage:** preliminary severity is based on reported human impact and operational disruption, while urgency is assessed separately. Critical is reserved for explicit mass-casualty/multiple-fatality, active hostage-crisis or widespread critical-service-impact indicators; a generic attack/bomb/protest keyword cannot produce Critical. Peaceful protest, routine traffic and minor crime without stated harm remain Low. Source reliability, independent-source count, confidence and verification state never raise severity by themselves. A single-source lead remains unverified, and an analyst must validate the report before operational use.
- **Operational consequence:** connect warning and exposure objects to places and operational objects without displacing Sonalit's existing systems of record. Crisis24 illustrates location-centric risk management: https://www.crisis24.com/

## Information architecture
### Command Picture
Persistent theatre and analytic-window controls; server-side headline totals; geographic event objects only where coordinates exist; separate map, warning register, country watch, event ledger and evidence assurance. A capped event list is not a time-window total.

### Analysis Workbench
Retains the existing ten views: situation, signals, operations, atlas, countries, investigations, forecasts, publications, watchlists and sources. Its event query now uses the same validated server-side analytic window as the command aggregates.

### Incident Fabric
Shows returned public-signal leads in the rolling API window. API failure is not an empty result. Unknown source counts remain unknown. A public lead is not a verified incident.

### Newsroom
Displays persisted observations and original-source links. Lexical matching is explicitly a text-triage cue, not event severity, probability or analyst assessment.

### Collection Control
Uses the source registry and each source's persisted latest `health` run plus observation metrics. Discovery/link-out, authorized-only bridges, inactive sources, unknown runs, failed runs and stale successes are distinct. Manual collection responses are interpreted from provider-level outcomes; cluster-lock skips and provider failures remain visible. Secrets are never rendered.

### Publications
Preserves existing review, evidence, quality, version, handling and PDF release gates. A draft or successful render is not an approved publication or distribution event.

## Data and trust contract
| Object | Meaning | Must not be confused with |
|---|---|---|
| Observation | Source material captured at an observed time | Verified fact or fused event |
| Event | Fused object with linked observations and recorded severity/confidence | Raw article or keyword match |
| Early warning | Persisted signal/risk indicator with status and evidence | Confirmed incident |
| Assessment | Analyst judgement with confidence, scope and validity | Automated keyword cue |
| Forecast | Time-bounded judgement with assumptions and invalidation triggers | Prediction certainty |
| Collection run | Provider-specific execution record and outcome | Global source completeness |
| Source registry row | Provenance configuration and catalog reliability | Proof of a recent successful collection |

Unknown is not zero. A recent successful run does not prove collection completeness. Observation volume does not prove source diversity. Event confidence and source reliability are separate measures.

## Source policy
- NewsNow is a discovery/link-out lane when registry metadata says `role=discovery`, `collection_mode=link_out` or `observation_ingestion=false`; it is not a direct observation feed.
- SGA WhatsApp is an authorized-feed bridge only when its approved feed configuration exists. Do not scrape private groups, invent messages or show an unconfigured bridge as live.
- Mashinani/county source hints are not authoritative unless provider configuration explicitly marks them authoritative.
- Provider failures are isolated. One provider's failure does not make other providers appear failed or healthy.

## Security
The Intelligence Centre is restricted to `admin` and `super_admin`. The frontend route and both backend intelligence API routers enforce this after authentication. Database reads continue through authenticated tenant context and organization-scoped DB helpers.

## Delivery phases
1. **Command and trust foundation (this tranche):** unified shell; command picture; source/collection control; server-side analytic windows; admin boundary; lexical-cue correction; evidence-truth regression coverage.
2. **Investigation depth:** entity/event graph, contradiction pivots, source diversity, time-scrubbed history and object-level spatial timelines.
3. **Analyst workflow:** requirements-to-collection tasking, assessment drafting and peer review, forecast calibration, invalidation triggers and auditable changes.
4. **Dissemination and coverage:** publication gates, country coverage/collection-gap matrix, localized briefs and scheduled publication runs with provider evidence and failure reports.

## Acceptance rules
- No synthetic intelligence or sample telemetry in production.
- No “live”, “healthy” or “complete” claim without a persisted source/run or response state.
- No inferred severity from lexical cues.
- No complete time-window total from a capped list.
- No map marker without persisted coordinates.
- No cross-tenant record or non-approved role can access intelligence APIs.

## Incident severity model

The deterministic `sonalit-impact-urgency-v1` model is a transparent first-pass triage of visible source text. It records category, severity, impact, urgency, trigger indicators and a human-readable basis in observation/alert/event metadata. It is not a machine probability, fact-verification label or substitute for analyst judgement.

| Level | Threshold principle | Typical examples |
|---|---|---|
| Critical | Explicit catastrophic human impact or widespread critical-service consequences | Reported mass-casualty/multiple-fatality incident, active hostage crisis, widespread essential-service disruption |
| High | Serious direct threat or reported harm | Armed attack/ambush, kidnapping, explosive incident, fatality or serious/multiple injuries |
| Medium | Material but bounded harm or disruption | Violent disorder without severe injury, road/access disruption, structural fire, significant accident or severe local hazard |
| Low | Limited or unstated harm | Peaceful protest/rally, routine congestion, minor accident or property crime without serious harm |

Urgency is independent from severity. Severity is not increased by source reliability, source count, negative article tone or a lexical match alone. Confidence measures source/evidence quality and is capped at 45 for one independent source, 65 for two and 85 for three or more; multiple queries/feed URLs from the same publisher or news aggregator are not independent sources. Verification remains `unverified` until a separate analyst/verification workflow records otherwise. Analyst overrides are protected from automated re-triage.

RSS/Atom and other external text is converted to plain text at ingestion: tags and attributes are removed, visible anchor text is retained, and entities such as `&nbsp;` are decoded. Historic records are also normalized at presentation time. Source URLs remain separate, clickable provenance fields; feed markup is never rendered as HTML.
