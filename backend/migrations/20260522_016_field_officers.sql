CREATE TABLE IF NOT EXISTS field_officers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID,
  name VARCHAR(256) NOT NULL,
  badge_number VARCHAR(64) NOT NULL,
  phone VARCHAR(32) NOT NULL,
  assigned_zone VARCHAR(128),
  status VARCHAR(32) NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'busy', 'offline')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_field_officers_org_id ON field_officers(org_id);
CREATE INDEX IF NOT EXISTS idx_field_officers_status ON field_officers(status);
