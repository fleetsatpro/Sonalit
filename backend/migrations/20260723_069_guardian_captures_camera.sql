-- Which lens a covert capture came from ("back" = rear/scene, "front" = selfie
-- of whoever holds the device). Each capture_photo command now takes a shot
-- from BOTH lenses, so a single command produces two rows that dispatch needs
-- to tell apart. NULL for pre-existing rows (single-lens captures) — the UI
-- simply shows no lens badge for those.
ALTER TABLE guardian_captures ADD COLUMN IF NOT EXISTS camera TEXT;
