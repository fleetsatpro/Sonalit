-- shipment_manifest_items: structured line-item cargo manifest linked to a shipment
-- org_id is denormalised here for fast RLS and partition pruning

CREATE TABLE IF NOT EXISTS shipment_manifest_items (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID        NOT NULL,
  shipment_id UUID        NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  description TEXT        NOT NULL CHECK (char_length(description) BETWEEN 1 AND 512),
  quantity    INTEGER     NOT NULL CHECK (quantity > 0),
  weight_kg   NUMERIC(10,3),
  value       NUMERIC(14,2),
  currency    CHAR(3),
  handling    TEXT        NOT NULL DEFAULT 'standard'
              CHECK (handling IN ('standard','fragile','hazmat','cold_chain','high_value')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_manifest_items_shipment
  ON shipment_manifest_items(shipment_id) WHERE deleted_at IS NULL;

-- RLS: protect operator access; clientAuth routes rely on explicit WHERE org_id = $n
ALTER TABLE shipment_manifest_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON shipment_manifest_items
  USING (org_id = current_setting('app.current_org_id', true)::uuid);
