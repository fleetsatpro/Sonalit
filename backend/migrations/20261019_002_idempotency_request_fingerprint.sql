-- Bind each idempotency key to a canonical request fingerprint.
-- Existing receipts retain NULL fingerprints for backwards compatibility.
ALTER TABLE public.idempotency_keys
  ADD COLUMN IF NOT EXISTS request_hash CHAR(64);

COMMENT ON COLUMN public.idempotency_keys.request_hash IS
  'SHA-256 of canonical HTTP method, URL and JSON body; prevents a key from being reused for a different mutation.';
