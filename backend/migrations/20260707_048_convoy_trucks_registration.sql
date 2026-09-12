-- convoy_trucks had no way to record a plate/registration number of its own —
-- it only ever showed up via a JOIN to vehicles.registration, so a truck added
-- without a linked fleet vehicle (now possible since migration 047) had no
-- identifying plate number anywhere: not in the CFO app, not in PDF reports.
ALTER TABLE convoy_trucks ADD COLUMN IF NOT EXISTS registration TEXT;
