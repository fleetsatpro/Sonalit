-- Access requests and contact enquiries from the public website.
--
-- The "Request access" form on /login has posted to /api/v1/auth/request-access
-- since it was written, but that endpoint never existed — every submission
-- since has been silently lost. This table is where they land now, alongside
-- enquiries from the public /contact page.
--
-- Deliberately NOT tenant-owned, so it carries no org_id and no RLS policy:
-- the people filling these forms have no account and belong to no organisation
-- yet — that is the entire point of the request. Applying the org isolation
-- policy would make every row invisible, since there is no app.current_org_id
-- to match against. Reads happen out-of-band (ops mailbox, or psql) rather than
-- through an org-scoped API, so no tenant data is exposed by its absence.

CREATE TABLE IF NOT EXISTS access_requests (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source        TEXT NOT NULL DEFAULT 'login',
  name          TEXT,
  email         TEXT NOT NULL,
  organization  TEXT,
  message       TEXT,
  status        TEXT NOT NULL DEFAULT 'new',
  -- Whether the notification email actually left the building. False means the
  -- row is the only record of the request, so it must not be missed.
  notified      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  handled_at    TIMESTAMPTZ
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'access_requests_source_check') THEN
    ALTER TABLE access_requests
      ADD CONSTRAINT access_requests_source_check
      CHECK (source IN ('login', 'contact'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'access_requests_status_check') THEN
    ALTER TABLE access_requests
      ADD CONSTRAINT access_requests_status_check
      CHECK (status IN ('new', 'contacted', 'closed'));
  END IF;
END $$;

-- Triage queue: the open requests, newest first.
CREATE INDEX IF NOT EXISTS idx_access_requests_open
  ON access_requests(created_at DESC)
  WHERE status = 'new';

-- Anything that failed to notify needs picking up by hand.
CREATE INDEX IF NOT EXISTS idx_access_requests_unnotified
  ON access_requests(created_at DESC)
  WHERE notified = FALSE;
