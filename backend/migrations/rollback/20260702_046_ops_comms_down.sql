-- 046 DOWN — reverse the Ops Comms replacement.
--
-- Drops the six new tables and restores the legacy channels/messages tables
-- from their _legacy_2026_07 rename. Any messages posted through the new
-- schema are discarded — they cannot be moved back into the flat legacy
-- shape without lossy conversion, so this migration is destructive on the
-- forward-schema side. Legacy prod rows survive because we renamed rather
-- than dropped in the UP migration.

BEGIN;

-- Drop in dependency order (children first).
DROP TABLE IF EXISTS pinned_messages     CASCADE;
DROP TABLE IF EXISTS message_reactions   CASCADE;
DROP TABLE IF EXISTS message_attachments CASCADE;
DROP TABLE IF EXISTS messages            CASCADE;
DROP TABLE IF EXISTS channel_members     CASCADE;
DROP TABLE IF EXISTS channels            CASCADE;

-- Restore the legacy names so the old messageController shape is reachable
-- again if the app is rolled back.
ALTER TABLE IF EXISTS channels_legacy_2026_07 RENAME TO channels;
ALTER TABLE IF EXISTS messages_legacy_2026_07 RENAME TO messages;

COMMIT;
