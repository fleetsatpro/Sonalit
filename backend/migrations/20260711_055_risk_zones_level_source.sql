-- The OSINT auto-severity sweep (riskOsint.js) recomputes risk_zones.level
-- from risk_events every 2 hours. Without a floor, a zone an admin manually
-- set to 'high' (or the curated seed data) gets silently demoted to 'low'
-- the first time a sweep finds zero matching OSINT events for it — absence
-- of automated evidence isn't the same as absence of danger. level_source
-- tracks whether the current level came from an admin (protected from
-- automatic downgrade) or from the automated sweep itself (free to move
-- both up and down once it has taken over from a manual baseline).
ALTER TABLE risk_zones ADD COLUMN IF NOT EXISTS level_source TEXT NOT NULL DEFAULT 'manual'
  CHECK (level_source IN ('manual', 'auto'));
