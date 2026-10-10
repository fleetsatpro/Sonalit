# Sonalit Intelligence Collection Fabric

The Intelligence Centre has a provider-isolated collection fabric feeding `intel_observations`, durable collection telemetry, and deterministic fusion into `intel_events`.

## Collection cadence

- Default: every 30 minutes.
- Override with `INTEL_COLLECTION_INTERVAL_MINUTES` (minimum 5 minutes).
- Startup collection is delayed by 20 seconds so migrations/database startup can settle.
- A process-local guard prevents overlap inside one process.
- A PostgreSQL advisory lock prevents concurrent collection cycles across Railway replicas.
- Every provider run records seen, inserted, duplicate, error and failure metadata in `intel_collection_runs`.

## Providers

### GDELT
Always available when the public endpoint is reachable. Queries configured country coverage from `INTEL_COUNTRIES` (or Sonalit's default security-country set). GDELT is discovery/news evidence, not ground truth. GDELT's own data model is designed for high-volume global event/news monitoring, so Sonalit keeps it bounded and treats outages/rate limits as provider-local failures.

### X
Enabled with `X_BEARER_TOKEN`. Uses the official X API v2 Recent Search endpoint, which is limited to the most recent seven days for standard recent search. Sonalit uses bounded pagination and country/security queries; it does not pretend to have full-archive access. X supports `since_id` polling and pagination, which can be added to higher-frequency watchlists without scraping the platform.

### Facebook / Meta
Enabled with `META_ACCESS_TOKEN` and `META_PAGE_IDS`. `META_PAGE_IDS` is JSON, for example:

```json
[{"id":"123456789","country_code":"KE"}]
```

Only pages for which the configured token is legitimately authorized should be supplied. The Graph API version is configurable through `META_GRAPH_VERSION` and defaults to the current implementation target. The collector does not attempt private-profile or access-control bypasses.

### Telegram
Enabled with `INTEL_TELEGRAM_CHANNELS` JSON. Example:

```json
[{"channel":"example_channel","country_code":"KE"}]
```

Public channels can use the existing MTProto integration when configured, with the public channel preview as a bounded fallback. Private chats/groups and access-control bypasses are never part of the collector.

### ReliefWeb
Enabled only when `RELIEFWEB_APP_NAME` is configured with a valid, approved ReliefWeb application name. ReliefWeb API v2 currently requires an appname and, since 1 November 2025, that appname must be pre-approved. If the variable is absent, Sonalit disables this provider rather than generating repeated unauthorized requests.

### ACLED
Enabled with `ACLED_USERNAME` and `ACLED_PASSWORD`. Recent conflict-event data is collected through the documented ACLED API and retained as source observations. ACLED data remains attributable evidence; Sonalit does not rewrite it as independently verified intelligence.

### GDACS
Public disaster/hazard events are collected from the GDACS event API and linked to configured countries. This provides a non-conflict hazard stream for floods, storms, earthquakes and other emergency events that can affect routes and operations.

### RSS / publisher feeds
Configured with `INTEL_RSS_FEEDS` JSON. Example:

```json
[
  {"name":"Example Security Desk","url":"https://example.com/feed.xml","country_code":"KE","language":"en","credibility":60}
]
```

This is also the controlled extension point for approved government, media, NGO, YouTube-channel and specialist feeds that expose a legitimate RSS/Atom interface.

## Evidence model

Every collected item becomes an `intel_observations` record containing:

- provider/source identity
- external identifier
- observed and published timestamps
- title/body/link
- country when deterministically identified
- language
- latitude/longitude when supplied by the provider
- content hash
- source credibility
- manipulation indicators
- raw provider metadata

Repeated observations refresh `last_seen_at` rather than creating unlimited duplicates. Durable uniqueness is enforced by organisation + source + external identifier.

## Provider isolation

A failed provider never aborts the entire collection cycle. Timeouts, authentication failures, rate limits and malformed upstream responses are logged against that provider and recorded in collection telemetry. Providers without credentials remain cleanly disabled.

## Fusion

The deterministic fusion layer:

1. reads recent observations;
2. normalises security severity;
3. keeps source reliability separate from event severity;
4. groups observations into preliminary country-level event storylines;
5. retains each observation as an explicit event relationship;
6. increases confidence only when source diversity supports it.

This is deliberately conservative. A single social post is **not** treated as corroborated intelligence. Contradiction handling, stronger semantic entity resolution, geospatial clustering, coordinated-narrative detection, source-history scoring and analyst verification are higher-order intelligence stages.

## Publication research and evidence quality

The publication research layer reuses country-scoped publisher feeds configured through `INTEL_RSS_FEEDS`, `INTEL_PUBLICATION_RESEARCH_FEEDS`, or `RISK_INTEL_EXTRA_RSS_FEEDS`. It reuses the existing country-coded direct-publisher registry as well as the country-specific AllAfrica RDF feed, while keeping Google News as a separate discovery lane. Configured feeds must declare their country explicitly; feed location is a collection hint, not authoritative event attribution. Feed items are matched against incident headline/location/date, and article URLs are kept separate from feed URLs. Cross-domain canonical tags cannot redefine the domain that actually served an article body. Public fetches retain the existing SSRF, redirect, timeout and response-size protections. Short-lived response caching is bounded by entry count and a 16 MiB total body budget, in-flight de-duplication is enabled, and public fetch concurrency is capped. Failed HTTP and DNS/connection fetches are briefly negative-cached so one unavailable publisher does not generate one retry per incident. Opaque Google News story wrappers are resolved only through the existing public-address-validated HTTPS redirect fetcher; an unresolved wrapper is never treated as a publisher source. GDELT is an on-demand secondary fallback: it is not queried when first-party evidence and direct publisher/Google News article bodies already yield two substantive independent domains. The serialized GDELT lane remains a final guard against duplicate requests and bursty rate-limit failures.

A source title or metadata description alone is not proof of substantive research. The `researched_limited` classification requires attributable source material (retrieved article text, a substantial publisher RSS excerpt, or a substantial excerpt returned by a verified web-search citation), at least two independent publisher domains, a minimum material length per source and a minimum combined content threshold. `researched` requires actual fetched article bodies across two independent domains; search-result excerpts cannot qualify for that tier. When those tests fail, the dossier remains a fallback. Article bodies are used for research and validation in memory but are not duplicated into stored source-reference objects. Provider exhaustion does not itself make a fallback evidence-eligible: the underlying Sonalit event must still retain attributable observations and source records. The editorial, tradecraft and release gates remain authoritative; these source-discovery improvements must never silently publish a thin report.

## Operational rule

The Collection Fabric is an evidence-acquisition system. Collection volume is never equivalent to truth. Every downstream assessment and publication must preserve provenance, timestamp, source reliability, confidence and review state.
