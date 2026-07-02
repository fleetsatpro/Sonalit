-- 046 — Ops Comms (Messages) replacement
--
-- Replaces the legacy channels + messages tables (created ad-hoc by
-- messageController.ensureTables) with a full multi-tenant, RLS-enforced
-- Slack-style comms schema: channels, memberships, threads, attachments,
-- reactions, pins. Legacy tables are renamed (not dropped) so any prod
-- rows are preserved for audit; down-migration reverses the rename.
--
-- Every new table:
--   - has org_id UUID NOT NULL (no organizations FK — prod has no such table)
--   - ENABLE + FORCE ROW LEVEL SECURITY
--   - carries an org_isolation policy scoped to app.current_org_id
--     (matches convention set by migration 026)
--   - grants SELECT/INSERT/UPDATE/DELETE to sonalit_app (the NOBYPASSRLS
--     app role from migration 017 that withOrg() switches to)

BEGIN;

-- ── Step 1: rename legacy tables ─────────────────────────────────────────────
-- messageController.ensureTables() ran on module load and created these.
-- We rename rather than drop so audit trails are preserved. The controller
-- is being rewritten in this same commit so nothing will query the legacy
-- names once the app restarts.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='messages') THEN
    -- Drop the FK from legacy messages -> legacy channels so the rename doesn't
    -- fight the new channels table's PK on the same name.
    EXECUTE (
      SELECT 'ALTER TABLE messages DROP CONSTRAINT ' || quote_ident(conname)
        FROM pg_constraint
       WHERE conrelid = 'messages'::regclass
         AND contype  = 'f'
       LIMIT 1
    );
  END IF;
EXCEPTION WHEN OTHERS THEN
  -- No FK to drop — legacy table already migrated or never existed.
  NULL;
END $$;

ALTER TABLE IF EXISTS messages RENAME TO messages_legacy_2026_07;
ALTER TABLE IF EXISTS channels RENAME TO channels_legacy_2026_07;

-- ── Step 2: new tables ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS channels (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL,
  name          TEXT NOT NULL,
  slug          TEXT NOT NULL,
  type          TEXT NOT NULL DEFAULT 'public' CHECK (type IN ('public','private')),
  category      TEXT,                    -- 'priority' | 'regional' | 'operations' | NULL
  created_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (org_id, slug)
);

ALTER TABLE channels ENABLE  ROW LEVEL SECURITY;
ALTER TABLE channels FORCE   ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_isolation ON channels;
CREATE POLICY org_isolation ON channels
  USING       (org_id = current_setting('app.current_org_id', true)::uuid)
  WITH CHECK  (org_id = current_setting('app.current_org_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON channels TO sonalit_app;

CREATE INDEX IF NOT EXISTS idx_channels_org
  ON channels(org_id, category, created_at DESC);

CREATE TABLE IF NOT EXISTS channel_members (
  channel_id       UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_id           UUID NOT NULL,                -- denormalised for RLS
  is_channel_admin BOOLEAN NOT NULL DEFAULT false,
  muted            BOOLEAN NOT NULL DEFAULT false,
  last_read_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  joined_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (channel_id, user_id)
);

ALTER TABLE channel_members ENABLE  ROW LEVEL SECURITY;
ALTER TABLE channel_members FORCE   ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_isolation ON channel_members;
CREATE POLICY org_isolation ON channel_members
  USING       (org_id = current_setting('app.current_org_id', true)::uuid)
  WITH CHECK  (org_id = current_setting('app.current_org_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON channel_members TO sonalit_app;

CREATE INDEX IF NOT EXISTS idx_channel_members_user       ON channel_members(user_id);
CREATE INDEX IF NOT EXISTS idx_channel_members_channel    ON channel_members(channel_id);
CREATE INDEX IF NOT EXISTS idx_channel_members_channel_admin
  ON channel_members(channel_id)
  WHERE is_channel_admin = true;

CREATE TABLE IF NOT EXISTS messages (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL,
  channel_id    UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  author_id     UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  body          TEXT,
  reply_to_id   UUID REFERENCES messages(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  edited_at     TIMESTAMPTZ,
  deleted_at    TIMESTAMPTZ,             -- soft delete; body scrubbed on delete but row retained
  deleted_by    UUID REFERENCES users(id) ON DELETE SET NULL
);

ALTER TABLE messages ENABLE  ROW LEVEL SECURITY;
ALTER TABLE messages FORCE   ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_isolation ON messages;
CREATE POLICY org_isolation ON messages
  USING       (org_id = current_setting('app.current_org_id', true)::uuid)
  WITH CHECK  (org_id = current_setting('app.current_org_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON messages TO sonalit_app;

CREATE INDEX IF NOT EXISTS idx_messages_channel_created  ON messages(channel_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_reply_to         ON messages(reply_to_id) WHERE reply_to_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_messages_author           ON messages(author_id);

CREATE TABLE IF NOT EXISTS message_attachments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id    UUID REFERENCES messages(id) ON DELETE CASCADE,   -- nullable so a row can exist between presign & send
  org_id        UUID NOT NULL,
  uploader_id   UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  kind          TEXT NOT NULL CHECK (kind IN ('photo','file')),
  storage_key   TEXT NOT NULL UNIQUE,           -- R2 object key; NEVER a raw signed URL
  file_name     TEXT NOT NULL,
  size_bytes    BIGINT NOT NULL,
  mime_type     TEXT NOT NULL,
  width         INT,
  height        INT,
  finalized_at  TIMESTAMPTZ,                    -- NULL until commit endpoint runs
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Ops-comms attachments are not chain-of-custody photos (that's guardianConvoy's
  -- domain), so we intentionally do NOT enforce EXIF/GPS. General chat images.
  -- Still block data-URI abuse the same way migration 008 did for other pipelines.
  CONSTRAINT message_attachments_no_data_uri CHECK (storage_key NOT LIKE 'data:%')
);

ALTER TABLE message_attachments ENABLE  ROW LEVEL SECURITY;
ALTER TABLE message_attachments FORCE   ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_isolation ON message_attachments;
CREATE POLICY org_isolation ON message_attachments
  USING       (org_id = current_setting('app.current_org_id', true)::uuid)
  WITH CHECK  (org_id = current_setting('app.current_org_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON message_attachments TO sonalit_app;

CREATE INDEX IF NOT EXISTS idx_message_attachments_message ON message_attachments(message_id);
CREATE INDEX IF NOT EXISTS idx_message_attachments_pending ON message_attachments(uploader_id, created_at)
  WHERE finalized_at IS NULL;

CREATE TABLE IF NOT EXISTS message_reactions (
  message_id    UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_id        UUID NOT NULL,
  emoji         TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (message_id, user_id, emoji)
);

ALTER TABLE message_reactions ENABLE  ROW LEVEL SECURITY;
ALTER TABLE message_reactions FORCE   ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_isolation ON message_reactions;
CREATE POLICY org_isolation ON message_reactions
  USING       (org_id = current_setting('app.current_org_id', true)::uuid)
  WITH CHECK  (org_id = current_setting('app.current_org_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON message_reactions TO sonalit_app;

CREATE INDEX IF NOT EXISTS idx_message_reactions_message ON message_reactions(message_id);

CREATE TABLE IF NOT EXISTS pinned_messages (
  channel_id    UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  message_id    UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  org_id        UUID NOT NULL,
  pinned_by     UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  pinned_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (channel_id, message_id)
);

ALTER TABLE pinned_messages ENABLE  ROW LEVEL SECURITY;
ALTER TABLE pinned_messages FORCE   ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_isolation ON pinned_messages;
CREATE POLICY org_isolation ON pinned_messages
  USING       (org_id = current_setting('app.current_org_id', true)::uuid)
  WITH CHECK  (org_id = current_setting('app.current_org_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON pinned_messages TO sonalit_app;

CREATE INDEX IF NOT EXISTS idx_pinned_messages_channel ON pinned_messages(channel_id, pinned_at DESC);

-- ── Step 3: seed default channels per org, add every active user as a member ─
--
-- Seeds the minimum set (#general, #alerts, #emergency, #dispatch) for every
-- org that has at least one active user. Every active user in the org becomes
-- a member; role='admin' users become channel admins. Uses raw SQL (no
-- app.current_org_id) — migrations bypass RLS because they run as superuser.

DO $$
DECLARE
  o RECORD;
  seed RECORD;
  chan_id UUID;
BEGIN
  FOR o IN (SELECT DISTINCT org_id FROM users WHERE deleted_at IS NULL AND org_id IS NOT NULL) LOOP
    FOR seed IN (
      SELECT * FROM (VALUES
        ('alerts',    'priority',   'System alerts & broadcasts'),
        ('emergency', 'priority',   'Emergency comms'),
        ('dispatch',  'operations', 'Dispatch and routing'),
        ('general',   'operations', 'Everyone in the org')
      ) AS t(slug, category, name)
    ) LOOP
      INSERT INTO channels (org_id, name, slug, type, category)
      VALUES (o.org_id, seed.slug, seed.slug, 'public', seed.category)
      ON CONFLICT (org_id, slug) DO NOTHING
      RETURNING id INTO chan_id;

      IF chan_id IS NULL THEN
        SELECT id INTO chan_id FROM channels WHERE org_id = o.org_id AND slug = seed.slug;
      END IF;

      -- Every active user in the org joins; admins are channel admins.
      INSERT INTO channel_members (channel_id, user_id, org_id, is_channel_admin)
      SELECT chan_id, u.id, o.org_id, (u.role = 'admin')
        FROM users u
       WHERE u.org_id = o.org_id
         AND u.deleted_at IS NULL
         AND u.status = 'active'
      ON CONFLICT (channel_id, user_id) DO NOTHING;
    END LOOP;
  END LOOP;
END $$;

COMMIT;
