-- S2-F7: Voice Notes
-- RULE A: ENABLE + FORCE RLS + org_isolation

CREATE TABLE IF NOT EXISTS voice_notes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL,
  parent_type     VARCHAR(50) NOT NULL,  -- shift_handover | incident | convoy | claim
  parent_id       UUID NOT NULL,
  uploaded_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  storage_key     VARCHAR(500) NOT NULL,  -- S3/GCS object key
  duration_sec    INTEGER,
  file_size_bytes INTEGER,
  mime_type       VARCHAR(100) DEFAULT 'audio/webm',
  transcript      TEXT,  -- async speech-to-text result
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ
);

ALTER TABLE voice_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE voice_notes FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS org_isolation ON voice_notes;
CREATE POLICY org_isolation ON voice_notes
  USING (org_id = current_setting('app.current_org_id', true)::uuid)
  WITH CHECK (org_id = current_setting('app.current_org_id', true)::uuid);

GRANT SELECT, INSERT, UPDATE ON voice_notes TO sonalit_app;

CREATE INDEX IF NOT EXISTS idx_voice_notes_parent ON voice_notes (parent_type, parent_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_voice_notes_org ON voice_notes (org_id, created_at DESC);

-- Wire FK from shift_handovers.voice_note_id now that voice_notes table exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'shift_handovers_voice_note_id_fkey'
      AND table_name = 'shift_handovers'
  ) THEN
    ALTER TABLE shift_handovers
      ADD CONSTRAINT shift_handovers_voice_note_id_fkey
      FOREIGN KEY (voice_note_id) REFERENCES voice_notes(id) ON DELETE SET NULL;
  END IF;
END $$;
