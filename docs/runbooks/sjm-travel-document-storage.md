# SJM travel-document storage runbook

## Scope

This runbook applies only to the Secure Journey Management traveller document register (passports, visas, e-tickets, booking confirmations, insurance and supporting travel papers). It does not change Sonalit convoy media storage, CCTV storage or general evidence retention.

Travel documents are classified `HIGHLY_SENSITIVE`. The API must not fall back to the shared `sonalit-convoy-photos` bucket, an application-wide R2 bucket, or a public object URL.

## Required service configuration

Provision a dedicated **private** Cloudflare R2 bucket for SJM. Use a bucket and credentials that are not shared with general Sonalit media. Configure the backend service environment with:

- `SJM_R2_ACCOUNT_ID`: Cloudflare account identifier.
- `SJM_R2_ACCESS_KEY` and `SJM_R2_SECRET_KEY`: credentials scoped to the dedicated SJM bucket.
- `SJM_R2_BUCKET`: the dedicated private bucket name.

Do not put credentials in source control, frontend variables, browser storage, logs, issue descriptions or screenshots. Do not reuse `R2_ACCESS_KEY`, `R2_SECRET_KEY` or `R2_BUCKET` credentials/bucket values. The backend rejects a shared bucket or reused credentials.

## Browser CORS

For the exact Sonalit web application origins that are authorised to use SJM, configure the R2 bucket CORS rule to permit:

- Origin: exact production and approved staging origins only; no wildcard origin.
- Method: `PUT`.
- Request headers: `Content-Type`, `If-None-Match`, `x-amz-meta-evidence-id`, `x-amz-meta-journey-id`.
- Expose response header: `ETag` if required by the browser/runtime.
- Max age: keep the preflight cache bounded (for example, 300 seconds).

No browser credentials or cookies should be sent to R2. The UI uses the short-lived signed upload capability and the exact headers returned by the API.

## Upload and verification contract

1. An authorised mobility manager creates a document entry for a registered traveller.
2. The backend validates the document type, metadata, MIME type and permitted size, then creates a five-minute single-object upload capability.
3. The browser uploads directly to the private bucket.
4. The browser calls the SJM evidence commit endpoint.
5. The backend verifies the stored object's size, MIME type, identity metadata and content signature, computes SHA-256, and records the evidence as `VERIFIED`.
6. The travel-document entry then enters `PENDING_REVIEW`. An authorised manager records a separate review decision and rationale.

Supported file types and limits are currently PDF (25 MiB), JPEG (20 MiB) and PNG (20 MiB). The download URL is short-lived (two minutes) and is issued only after evidence integrity verification. Field-duty users must not be able to list or download `HIGHLY_SENSITIVE` traveller documents.

## Release verification

Before enabling uploads in a production environment:

- Confirm the dedicated private bucket exists and is not exposed through a public custom domain.
- Confirm the dedicated SJM credentials are bucket-scoped and are not reused elsewhere.
- Configure exact-origin CORS and test a real browser preflight plus PUT from the approved Sonalit origin.
- Confirm `SJM_R2_*` is configured only in the backend secret store.
- Upload a non-sensitive test PDF using an authorised test traveller; confirm a 5-minute capability, successful PUT, verified commit, SHA-256 record and separate manager review.
- Confirm an assigned driver/CPO cannot see document metadata in the evidence register and receives no download URL for a highly sensitive document.
- Confirm an unauthorised organisation cannot read the traveller or document row.
- Confirm an invalid or truncated file remains unavailable for download and is not marked verified.

Do not mark the travel-document feature operational solely because the UI or upload URL endpoint is visible. Until the dedicated bucket, credentials and CORS are configured and tested, the correct API response is an explicit unavailable error. No public or shared-storage fallback is permitted.
