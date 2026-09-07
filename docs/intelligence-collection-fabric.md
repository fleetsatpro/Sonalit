# Sonalit Intelligence Collection Fabric

The Intelligence Centre now has a provider-isolated collection fabric feeding `intel_observations` and deterministic event fusion into `intel_events`.

## Collection cadence

- Default: every 30 minutes.
- Override with `INTEL_COLLECTION_CRON` using a node-cron expression.
- A startup collection is delayed by 15 seconds so migrations/database startup can settle.
- One collection run is process-locked; a slow run cannot overlap itself.

## Providers

### GDELT
Always available. Queries the countries represented by active Intelligence watchlists or active Risk zones. GDELT is treated as discovery/news evidence, not ground truth.

### X
Enabled with `X_BEARER_TOKEN`. Uses the official recent-search API. Queries are country-scoped and filtered for security-relevant terms. Recent Search is intentionally used rather than pretending the application has full-archive access.

### Facebook / Meta
Enabled with `META_ACCESS_TOKEN` and `META_PAGE_IDS`. `META_PAGE_IDS` is JSON, for example:

```json
[{"id":"123456789","country_code":"KE"}]
```

Only pages for which the configured token is legitimately authorized should be supplied. The connector reads page-feed content exposed by the authorized Graph API access.

### Telegram
Enabled with `INTEL_TELEGRAM_CHANNELS` JSON. Public channels can be collected through the existing MTProto integration when configured, with the public channel preview as a bounded fallback. Example:

```json
[{"channel":"example_channel","country_code":"KE"}]
```

Private chats/groups and access-control bypasses are never part of the collector.

### ReliefWeb
Enabled only when `RELIEFWEB_APP_NAME` is configured with a valid, approved ReliefWeb application name. If it is absent, the provider remains disabled instead of repeatedly generating unauthorized requests.

### RSS
Configured with `INTEL_RSS_FEEDS` JSON. Example:

```json
[
  {"name":"Example Security Desk","url":"https://example.com/feed.xml","country_code":"KE","language":"en","credibility":60}
]
```

## Evidence model

Every collected item becomes an `intel_observations` record containing:

- provider/source identity
- external identifier
- observed/published timestamps
- title/body/link
- country when deterministically identified
- language
- content hash
- source credibility
- manipulation score
- raw provider metadata

Repeated observations are refreshed rather than blindly duplicated.

## Fusion

The first fusion layer is deliberately conservative:

1. discard observations without a resolvable country for country-level event creation;
2. derive a transparent preliminary severity from security indicators;
3. group repeated observations into a 48-hour event storyline when organisation, country and title match;
4. retain every source observation as an explicit event relationship;
5. preserve source credibility separately from event severity.

This is the ingestion/fusion foundation. It does **not** claim that a single source has corroborated an event. Higher-order corroboration, contradiction detection, entity resolution, geospatial clustering and analyst verification are subsequent Intelligence Centre stages.

## Important operating rule

The Collection Fabric is a discovery and evidence-acquisition system. It must never silently convert social-media content into verified intelligence. Confidence and publication status remain separate from collection volume.
