-- proof_of_delivery: POD records linked to a convoy (one or more per convoy)

CREATE TABLE IF NOT EXISTS proof_of_delivery (
  id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         UUID         NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  convoy_id      UUID         NOT NULL REFERENCES convoys(id) ON DELETE CASCADE,
  shipment_id    UUID         REFERENCES shipments(id) ON DELETE SET NULL,
  delivered_at   TIMESTAMPTZ  NOT NULL,
  recipient_name TEXT         NOT NULL CHECK (char_length(recipient_name) BETWEEN 1 AND 128),
  signature_url  TEXT,
  photo_urls     TEXT[]       NOT NULL DEFAULT '{}',
  location_lat   NUMERIC(10,7),
  location_lng   NUMERIC(10,7),
  notes          TEXT         CHECK (char_length(notes) <= 1024),
  pod_pdf_url    TEXT,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pod_convoy ON proof_of_delivery(convoy_id);
CREATE INDEX IF NOT EXISTS idx_pod_org    ON proof_of_delivery(org_id);

ALTER TABLE proof_of_delivery ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON proof_of_delivery
  USING (org_id = current_setting('app.current_org_id', true)::uuid);
