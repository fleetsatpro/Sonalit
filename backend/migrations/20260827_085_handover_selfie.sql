-- Add selfie columns to convoy_handovers for sign-off verification
ALTER TABLE convoy_handovers
  ADD COLUMN IF NOT EXISTS selfie_key TEXT,
  ADD COLUMN IF NOT EXISTS selfie_url TEXT;
