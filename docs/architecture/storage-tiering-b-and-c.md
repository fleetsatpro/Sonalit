# Sonalit storage tiering: Railway PostgreSQL + Cloudflare R2

**Status:** architecture and read-only preflight; no production data is moved by this document.  
**Scope:** Option B (a separate Railway PostgreSQL service) plus Option C (Cloudflare R2), keeping the current operational database authoritative.

## Executive decision

Use three storage roles with clear boundaries:

1. **Operational PostgreSQL (OLTP):** users, organizations, permissions, bookings, containers, locks, current trips/journeys, latest canonical positions, live incident state, and transactions that must be atomic.
2. **Secondary PostgreSQL (analytics/archive catalog):** aggregate projections, archive manifests, job state, reconciliation watermarks, and compact queryable analytics. It is not a replica, not a second authority for operational facts, and must not be required for live dispatch/tracking.
3. **Cloudflare R2:** file bytes and approved historical exports/archives. PostgreSQL retains object metadata, key, tenant, provenance, checksums, size, status, retention deadline and access-control context.

A second 5 GB volume creates another independent database disk; it does not extend the original disk or create cross-database joins/transactions. Do not point a second PostgreSQL service at the primary data directory. Do not attach, detach or delete the existing detached volumes until provenance and contents are verified.

## Current incident / go-live gate

The Railway production Postgres logs show WAL recovery failing with `No space left on device` while writing `pg_wal/xlogtemp.66`. This establishes an actual disk-exhaustion event; it does **not** prove there is no additional corruption or recovery issue.

**Do not run data migrations, attach the secondary database to application traffic, prune source rows or repeatedly restart the primary as a storage fix.** First obtain a consistent backup/recovery copy and verify that it can be restored. Confirm the primary can accept connections and pass integrity checks. Storage offload is not a substitute for repairing WAL recovery.

The secondary service `Postgres--wsQ` has been provisioned in Railway production and its PostgreSQL deployment reports `SUCCESS` / `ready to accept connections`. It has its own 5,000 MB `postgres-volume-4Wke` and private endpoint `postgres-wsq`; there is no public domain or TCP proxy. The database-name-guarded schema was applied with a temporary in-platform bootstrap runner and verified against the target database: all four expected catalog/rollup tables exist, each has `tenant_id`, Row Level Security is enabled and forced, and no operational source rows were copied. The bootstrap runner was deleted after success. No existing application variables were changed; no application points to this database yet.

## Repository evidence and current gaps

The source tree already has multiple object-storage paths:

- `backend/src/workers/convoyReportWorker.js` uploads daily and archive PDFs to R2. The daily report path also stores the same PDF bytes in `convoy_daily_reports.pdf_data` (BYTEA) when that column is present, and may fall back to local disk. Railway's local filesystem is not a durable file store.
- `backend/src/services/intelligencePublicationPdf.js` stores publication PDFs using `pdf_key` and serves access through tenant/role-scoped logic. Reuse this access pattern where suitable.
- `backend/src/controllers/messageController.js` uses R2 object keys, presigned uploads and HEAD verification for operational communications attachments.
- Guardian captures, convoy handover files and insurance-claim PDFs have R2 upload paths, but some persist/return public URLs. Treat captures, convoy evidence, claim documents and client reports as sensitive until access requirements are proven.
- `backend/src/routes/gdpr.js` writes GZIP JSONL audit archives to R2 when the archive flag is enabled. Preserve retention and deletion semantics; archiving must not become indefinite retention by accident.
- `guardian_voice_messages.audio` is BYTEA (up to 2 MB per clip). Both `backend/src/routes/guardian.js` and `backend/src/routes/guardian-ops.js` have audio delivery paths that must migrate together.
- `backend/scripts/backfill-base64-photos.js` covers data URIs in `field_reports.photo_url` and `convoy_truck_photos.photo_url`, but only rows created in the preceding seven days. `backend/src/app.js` says the photo-backfill cron was removed, so the old runbook's claim that this runs daily is stale.
- Terraform declares media and reports buckets in `infra/terraform/modules/cloudflare/main.tf`; runtime commonly uses a shared `R2_BUCKET`, while `backend/src/routes/voiceNotes.js` still uses AWS-style `S3_BUCKET` configuration. Terraform declarations do not prove these live buckets exist, are in state, contain the current objects, or are wired to each service.
- `device_locations` and `tracking_locations` have many direct consumers across live fleet, convoy, tracking, incident/spatial and GDPR paths. Do not move either table wholesale without a separate dependency inventory and dual-store design.

## Data placement matrix

| Data class | Initial destination | Notes |
|---|---|---|
| Users, orgs, permissions, credentials, bookings, containers, locks, current trip/journey state | Operational PostgreSQL | Foreign keys, authorization and operational transactions stay together. |
| Current/most recent location and canonical tracking-session state | Operational PostgreSQL | Live map/dispatch decisions must not depend on archive or analytics availability. |
| Raw telemetry used by live replay, convoy reporting, trip reconciliation, incidents and GDPR export/purge | Keep in current PostgreSQL initially | Consider time partitioning and policy-approved retention first. Moving raw tables is a later, separately tested project. |
| Daily/weekly analytics projections and pre-aggregated counts | Secondary PostgreSQL | Clearly label source freshness, aggregation version and completeness. No mock/fallback numbers. Never use this DB to authorize operational actions. |
| Archive manifests, checksums, row counts, source ranges, retention dates, migration state and retryable job records | Secondary PostgreSQL | Small, queryable catalog; primary remains authority for the business entities. |
| Photos, surveillance captures, videos, voice clips, handover evidence, attachments, PDFs and exports | R2 | PostgreSQL keeps metadata and relationships, never a public/signed URL as the canonical key. |
| Historical audit/location exports | Private R2 archive only when retention policy requires it | Compress, checksum and reconcile before source deletion. Apply GDPR erasure to both stores. |
| Public marketing/static assets | Public media bucket only when publication is intended | Never place evidence, claims, client exports or private reports in that key space. |

### Secondary database contract

Start with a small, independently versioned schema:

- `storage_archive_manifest`: immutable archive ID, tenant, source relation/partition, covered time range, bucket/key, format/schema version, row count, compressed and uncompressed sizes, SHA-256, retention deadline, status, verification timestamp, release timestamp and failure reason.
- `storage_job_runs`: idempotency key, source range, job/version, status, attempt count, checksum, timings and bounded error reason.
- `analytics_ingest_watermarks`: unique stream/tenant/source cursor; advance only after the associated batch is durably committed and reconciled.
- `telemetry_daily_rollups` and module-specific aggregates only when the metric contract is explicit. Keep as little personal data and coordinate-level detail as the use case allows.

Use a separate migration runner targeting `ANALYTICS_DATABASE_URL`. Do not point the existing `backend/scripts/db-migrate.js` at the new service, and do not let the primary migration runner create analytics tables in the wrong database. Use Railway private networking only; no public TCP proxy. Use a separate least-privilege DB role. API reads should be read-only when possible; archive workers receive only the required write permissions.

The secondary DB should initially receive **derived, reproducible aggregates** plus the manifest/catalog. A later proposal to move historical raw telemetry to PostgreSQL #2 must enumerate every consumer, table owner, indexes/partition model, tenant boundary, retention obligations, backfill throughput, late-arriving events, idempotency and restore strategy. Never split a table merely because it is large.

## R2 architecture and bucket classes

### Reconcile existing Cloudflare state first

1. Inventory account buckets, custom domains, public-access settings, lifecycle rules, CORS and current object counts/bytes.
2. Run a Terraform plan using the correct existing Cloudflare state before applying. Existing code declares `sonalit-media-${environment}` and `sonalit-reports-${environment}`; do not create duplicates or rename a bucket solely to align variable names.
3. Map each Railway service to its intended bucket explicitly. Keep the existing `R2_BUCKET` compatibility path until all producers/consumers are migrated and verified.
4. Introduce `R2_MEDIA_BUCKET`, `R2_PRIVATE_EVIDENCE_BUCKET`, `R2_PRIVATE_REPORTS_BUCKET` and `R2_ARCHIVE_BUCKET` only when the actual bucket inventory, permissions, domains and deployments are confirmed. Names here are a proposed config contract, not a claim that these buckets already exist.

### Observed live R2 inventory — 2026-10-19

A bounded, read-only listing against the existing Railway-configured R2 bucket completed successfully. No object bodies were downloaded, and full object keys were not emitted.

| Bucket | Result | Objects listed | Bytes listed |
|---|---|---:|---:|
| `sonalit-convoy-photos` | Complete listing | 2,708 | 1,195,699,558 bytes (1,140.31 MiB) |

First-level prefix totals in this bucket:

| Prefix | Objects | Approximate size |
|---|---:|---:|
| `cfo/` | 319 | 646.41 MiB |
| `intelligence-publications/` | 2,241 | 430.28 MiB |
| `convoy-app/` | 50 | 30.06 MiB |
| `reports/` | 89 | 23.26 MiB |
| `handover-officer/` | 5 | 5.05 MiB |
| `orgs/` | 3 | 4.14 MiB |
| `comms/` | 1 | 1.10 MiB |

The S3 `ListBuckets` API returned `AccessDenied`, so this is a complete listing of the configured bucket, **not** a complete account-wide bucket inventory. The configured credentials could not list bucket names derived from the current Terraform declaration (`sonalit-media-production`, `sonalit-reports-production`, `sonalit-media-prod`, `sonalit-reports-prod`, and staging equivalents; each returned `NoSuchBucket`). This is evidence that those names are not accessible at those exact endpoints to this credential, not proof of the full Cloudflare account state. Review Terraform remote state and Cloudflare dashboard before creating or changing buckets.

This bucket is a mixed logical workload: convoy evidence, intelligence publication artifacts, reports and communications share one physical bucket. Its public-access configuration, custom domain and each object's access semantics were **not** established by object listing. Treat the entire bucket as sensitive until verified. Do not switch the whole bucket to public, add a public domain, rename it or change lifecycle rules as part of the storage migration. Bucket segregation must preserve every existing object and URL consumer, and sensitive reads must transition to authorized object-key lookups before any public URL is retired.

The temporary inventory function has been removed after the measurement; its logs showed no body downloads, no public domains and no attached volume. No existing R2 object was changed.

Recommended classes:

- **Public media:** only assets explicitly approved for public distribution, served from a custom domain/cache. Separate from private objects.
- **Private evidence:** field/CFO photos, Guardian captures, voice recordings, handover evidence and communications attachments.
- **Private reports:** convoy reports, client exports, insurance claims and restricted intelligence publications.
- **Cold archive:** compressed, policy-approved historical records, signed/manifested and restored only through an authorized workflow.

R2 buckets are private by default. A public bucket/custom domain makes objects available to anyone who can obtain the path. Do not use an R2 public base URL for sensitive material. Never persist presigned URLs; they are bearer tokens. Store only the bucket class + object key and issue fresh short-lived GET URLs after authorizing the user, tenant, parent record, action and evidence state. Redact query strings from logs.

### Unified object contract

Every writer/reader should use one shared, reviewed service contract:

1. Authenticate actor/device. Derive tenant ID server-side; reject tenant IDs, bucket names and unrestricted keys supplied by a client.
2. Authorize the parent entity and evidence type; create an opaque, immutable key under environment/tenant/data-class namespaces. Avoid personal details in keys.
3. Apply content-type allowlists, file-size limits and quotas. An extension or client-supplied MIME type is not proof of file type; verify actual content where supported.
4. Upload directly using a short-lived presigned PUT for browser/mobile files or stream through the backend for trusted internal workers. Use multipart uploads for large/resumable files; bound API memory.
5. Verify upload with HEAD (size and content type) and, for migration/backfill, compare a source-derived SHA-256 or a provider-supported checksum. Do not treat ETag as a universal SHA-256.
6. Persist object key, byte size, MIME, digest, uploader/device, tenant, parent record, provenance, lifecycle state and timestamps. Use unique/idempotency constraints for retries.
7. On read, re-authorize the parent record and stream bytes or generate a short expiry presigned GET (usually 1–5 minutes for sensitive evidence).
8. On delete/retention/GDPR erasure, delete or expire the R2 object and metadata; make partial failures visible and retryable. Never report erasure as successful until every store is reconciled.
9. Set correct content disposition and `Cache-Control: private, no-store` for sensitive downloads. Configure CORS to explicit Sonalit origins and needed methods/headers only.
10. Enable abandoned-multipart cleanup; log structured operation IDs, never signatures/secret values. Provide per-class quotas and monitor failed/unfinished uploads.

R2 supports presigned GET, HEAD, PUT and DELETE. Presigned URLs work against the R2 S3 API domain, not the custom public domain. Cloudflare docs: https://developers.cloudflare.com/r2/api/s3/presigned-urls/

## Prioritized migration plan

### Phase 0 — preserve and measure (no source writes)

- Recover the primary Postgres service safely from the disk/WAL incident, establish data integrity and take a restorable backup/PITR snapshot.
- Inspect detached volume provenance without attaching them to the live service.
- Run `node backend/scripts/storage-audit.js` with `DATABASE_URL` on a healthy source. The default mode is read-only metadata only; opt-in scans may be more expensive.
- Run the same read-only SQL baseline for largest tables, BYTEA columns, partition definitions and current table/index size.
- Inventory R2 buckets and object counts/bytes before migrations; verify Terraform state and bucket privacy. Do not print object keys or credentials in reports.

### Phase 1 — stop new waste and secure access

- Consolidate bucket/client configuration behind one shared storage service while maintaining legacy environment compatibility during rollout.
- Ensure private report/evidence/claim/capture objects are actually private; implement authenticated GET paths before changing existing URL fields.
- Improve operational visibility: storage health/read/write probe, failed-upload counters, reconciliation backlog, estimated R2 bytes by data class, and expiry/deletion failures.
- Stop new duplicated `convoy_daily_reports.pdf_data` writes only after the R2 object-key read path, private access and recovery fallback are production-tested. Do not drop historical bytes in the same deployment.
- Replace ephemeral local-disk fallback with durable R2 retry/outbox behavior (or leave a DB fallback until proven); generated reports must never be marked available when the only copy is ephemeral.

### Phase 2 — high-confidence media migration

1. Inline/base64 photos: scan all rows inside the permitted retention window (not only seven days), in small bounded batches. Record a manifest/cursor; upload; verify object size/checksum; compare-and-swap the source value so concurrent changes are not overwritten; then update the metadata/key. Keep original bytes until sample/full reconciliation passes.
2. Convoy PDFs: verify R2 objects and metadata; create an authenticated key-based download path; test every permission/tenant path; stop duplicating future PDF bytes in PostgreSQL; clear prior BYTEA copies in bounded batches only after restore samples pass.
3. Voice clips: add nullable object key and explicit migration state, support both old BYTEA and R2 reads, migrate both dispatch-to-device and device-to-dispatch directions, and verify device-token auth. Null/release BYTEA only after compatibility reads and rollback are proven.
4. Other PDFs/files (claims, handovers, Guardian captures, communication attachments): migrate only once their existing object key/URL, access policy, object existence and consumer routes have been reconciled.

Each batch should be retryable/idempotent, resumable from durable state, rate-limited, checksum-verified and report counts/bytes by status.

### Phase 3 — use secondary Postgres without changing live truth

- Create the private DB connection as a separate secret/reference; do not overwrite primary `DATABASE_URL`.
- Apply only the analytics/archive schema via its dedicated migration runner.
- Backfill aggregates from consistent source snapshots; include source watermark, metric version, built-at timestamp and completeness status.
- Reconcile aggregate totals against independently executed primary queries. Treat missing/stale secondary data as stale/unavailable, never fabricate replacement values.
- Exercise secondary DB outage: operational tracking, lock/clamp/unclamp, dispatch, evidence upload and core API flows must still work.
- Only after explicit review should any approved historical data class be archived to R2 and removed from primary partitions according to its retention policy.

### Phase 4 — cold archive and retention

- Keep location data inside the currently configured retention window unless the owner explicitly approves a policy/legal change. Current repository documentation describes `device_locations` as 90 days, `device_health` as 30 days and `guardian_audit_log` as 365 days. Archival is not authority to retain personal data forever.
- Where retention requires history beyond the hot window, export partition-by-partition to compressed JSONL initially (Parquet may be evaluated later). Use a stable schema version, tenant-scoped object key, row count, min/max timestamp, byte counts and cryptographic digest.
- Upload archive -> HEAD/checksum/read-back validate -> register manifest in secondary Postgres -> verify source range/counters -> only then drop eligible source partition/rows. Never delete first.
- Restore test every archive type to an isolated staging schema. GDPR export/purge must cover hot database, secondary DB, R2 objects, derivative thumbnails/previews and cached data.
- Apply lifecycle policies only to dedicated prefixes/buckets after legal retention review. Beware lifecycle rules are asynchronous (often within about 24 hours); do not make them the only mechanism for immediate deletion. Do not lock personal-data objects indefinitely if erasure is required.

## Cost and capacity controls

Cloudflare R2's current published Standard price is $0.015/GB-month after 10 GB-month free; the published free tier includes 1M Class A and 10M Class B operations/month. Internet egress has no R2 egress fee. Infrequent Access is $0.01/GB-month but adds retrieval charges and has a 30-day minimum; use only for infrequently read eligible archives after modelling requests/retrievals. Prices can change; use the current billing page before rollout:
- https://developers.cloudflare.com/r2/pricing/
- https://developers.cloudflare.com/r2/buckets/storage-classes/
- https://developers.cloudflare.com/r2/buckets/object-lifecycles/

Estimate monthly cost as storage by class + Class A write/list/multipart operations + Class B reads/HEAD/list operations + retrieval for Infrequent Access + any Cloudflare plan/service fees. R2's free tier is account-level usage, not a guaranteed allowance per bucket. Set cost alerts and do not aggressively split buckets without a security/operations reason.

Railway's Hobby plan allows at most ten volumes per project and 5 GB per volume; multiple volumes remain separate disks. Review the live plan/pricing before provisioning or changing capacity: https://docs.railway.com/volumes/reference and https://docs.railway.com/pricing/plans

## Acceptance gates (no merge/cutover until all pass)

- Primary database recovery is complete and a restorable backup is verified.
- Read-only baseline records DB/large-table/BYTEA size and R2 inventory without exposing secrets or private object keys.
- Secondary PostgreSQL is private, has a dedicated DB name/role, separate migration history, tested TLS/networking and no public TCP proxy.
- A second-DB outage cannot block operational write paths; stale analytics are visibly marked.
- Object uploads enforce tenant authorization, size/MIME checks, immutable key/idempotency, size + checksum verification and short-lived downloads.
- Sensitive buckets are private; public media is a distinct, explicitly approved class.
- No object deletion or BYTEA clearing precedes a verified R2 copy and restore test.
- Reconciliation proves source/object count, byte totals, hashes, metadata linkage and no orphaned references.
- GDPR export/purge, retention and legal hold semantics work across both databases and R2; archive restore is tested.
- Uploads, downloads, analytics, historical reporting and failure/retry paths are covered by automated tests.
- No mock values, unwired storage operations, silent fallback to a public bucket, or claims of success before postconditions are verified.
- No main-branch merge, production variable cutover or destructive source cleanup until the gates above and current required CI checks are green.

## Source references

- Railway volumes: https://docs.railway.com/volumes/reference
- Railway pricing: https://docs.railway.com/pricing/plans
- R2 pricing: https://developers.cloudflare.com/r2/pricing/
- Presigned URL security and supported operations: https://developers.cloudflare.com/r2/api/s3/presigned-urls/
- R2 lifecycle policies: https://developers.cloudflare.com/r2/buckets/object-lifecycles/
- R2 security/encryption: https://developers.cloudflare.com/r2/reference/data-security/
