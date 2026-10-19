# Data integrity hardening — 19 October 2026

## Guarantees introduced by this change

### Telemetry ingestion

- HTTP 202 means the accepted raw GPS observations and their publication intent committed together to PostgreSQL.
- The ingest service writes each observation to `gps_fixes` and a tenant-scoped `telemetry_ingest_outbox` row in one transaction.
- A bounded publisher delivers pending rows to JetStream and deletes only rows for which JetStream returned a publish acknowledgement. Failed sends are retained and retried with exponential backoff.
- Delivery is **at-least-once**, not a claim of exactly-once execution. A crash between broker acknowledgement and database commit may replay an event; downstream consumers must be idempotent.
- Service readiness includes PostgreSQL health, and the migration bootstrap runs before the ingest listener.
- A legacy duplicate that prevents creation of the unique `(device_id, seq_no, time)` index causes a fail-closed migration. Operators must reconcile the evidence rather than delete GPS records to force the index through.

### CDS lifecycle

- Booking clamp/unclamp and legacy trip-level clamp/unclamp perform their core state writes inside tenant-scoped transactions.
- Booking-container and electronic-lock rows are locked before lifecycle validation and mutation to prevent overlapping submissions from assigning the same resource twice.
- Custody evidence, audit rows, and core lifecycle writes commit or roll back together. A failed custody append cannot be reported as a successful handoff.
- Realtime publication and secondary tracking termination happen after the database transaction.
- Driver license verification is represented separately from driver presence. Missing license data remains NULL until verified. The migration clears only known `PENDING` license and paired transporter placeholders, and preserves all other license records.
- Manually created lock records use provider `unverified`; the record does not falsely imply an active SecuriSat integration.

### HTTP idempotency

- When a client supplies `X-Idempotency-Key`, the backend claims the key before executing the mutation.
- Concurrent use of the same tenant/key cannot enter the handler in parallel. An active request returns an explicit `409 idempotency_in_progress` response to a retry.
- Successful and deterministic client-error responses are persisted before being sent. Server-error responses release the pending claim for safe retry by transactional handlers.
- Keyless requests remain compatible for older online clients. Field/offline callers must reuse the original key rather than generate a new key for retries.

## Required verification before production rollout

1. Pass backend unit and integration suites, web typecheck/build, telemetry typecheck and unit tests, schema/invariant tests, and the complete CI workflow.
2. On staging or a restored database, confirm that the `gps_fixes` identity index can be created. If duplicates exist, inspect and classify them before remediation; do not delete raw GPS evidence to satisfy a constraint.
3. Exercise NATS downtime, process restart, retry and recovery. Confirm every acknowledged GPS fix remains in `gps_fixes` and pending outbox rows eventually publish. Consumers must be tested for duplicate delivery.
4. Inject failure after each clamp/unclamp write. Confirm that no partial trip/lock/manifest/custody/alert/audit state commits and no success response is produced without custody proof.
5. Submit concurrent clamp requests for one booking-container and concurrent requests for one e-lock. Only one request may allocate the resource.
6. Verify that new drivers with unknown credentials remain visibly `unverified`, and existing non-placeholder license records remain unchanged.
7. Test tenant isolation with the runtime database role and request path. A privileged database connection alone is not proof of row-level security.

No production database was queried or changed as part of this code change. Production readiness remains conditional on the checks above and on the live deployment's actual migration/configuration state.

## Design references

- AWS transactional outbox pattern: https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html
- NATS JetStream persistence and acknowledgement semantics: https://docs.nats.io/concepts/jetstream
- PostgreSQL explicit locking: https://www.postgresql.org/docs/current/explicit-locking.html
- OWASP multi-tenant security guidance: https://cheatsheetseries.owasp.org/cheatsheets/Multi_Tenant_Security_Cheat_Sheet.html
