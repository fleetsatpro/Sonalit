import { pool } from '../db.js';

async function migrate(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`
      CREATE EXTENSION IF NOT EXISTS "pgcrypto";
      CREATE EXTENSION IF NOT EXISTS "pg_trgm";

      CREATE TABLE IF NOT EXISTS organizations (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name        TEXT NOT NULL,
        slug        TEXT NOT NULL UNIQUE,
        plan        TEXT NOT NULL DEFAULT 'starter',
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at  TIMESTAMPTZ
      );

      CREATE TABLE IF NOT EXISTS users (
        id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id            UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        email             TEXT NOT NULL,
        name              TEXT NOT NULL,
        password_hash     TEXT,
        role              TEXT NOT NULL DEFAULT 'operator',
        totp_enabled      BOOLEAN NOT NULL DEFAULT FALSE,
        totp_secret_enc   TEXT,
        last_login_at     TIMESTAMPTZ,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at        TIMESTAMPTZ,
        UNIQUE (email, deleted_at)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS users_email_active_idx
        ON users (email) WHERE deleted_at IS NULL;
      CREATE INDEX IF NOT EXISTS users_org_id_idx ON users (org_id);

      CREATE TABLE IF NOT EXISTS passkeys (
        id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        credential_id    TEXT NOT NULL UNIQUE,
        public_key       TEXT NOT NULL,
        counter          BIGINT NOT NULL DEFAULT 0,
        aaguid           TEXT,
        transports       TEXT[],
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_used_at     TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS passkeys_user_id_idx ON passkeys (user_id);

      CREATE TABLE IF NOT EXISTS token_families (
        id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id                  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        org_id                   UUID NOT NULL,
        last_refresh_token_hash  TEXT NOT NULL,
        refresh_count            INT NOT NULL DEFAULT 0,
        revoked_at               TIMESTAMPTZ,
        created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS token_families_user_id_idx ON token_families (user_id);

      CREATE TABLE IF NOT EXISTS api_keys (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id        UUID NOT NULL,
        user_id       UUID REFERENCES users(id) ON DELETE SET NULL,
        name          TEXT NOT NULL,
        key_hash      TEXT NOT NULL UNIQUE,
        key_prefix    TEXT NOT NULL,
        scopes        TEXT[] NOT NULL DEFAULT '{}',
        rate_tier     TEXT NOT NULL DEFAULT 'standard',
        ip_allowlist  INET[],
        last_used_at  TIMESTAMPTZ,
        expires_at    TIMESTAMPTZ,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at    TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS api_keys_org_id_idx ON api_keys (org_id);
      CREATE INDEX IF NOT EXISTS api_keys_key_hash_idx ON api_keys (key_hash);

      CREATE TABLE IF NOT EXISTS totp_challenges (
        token      TEXT PRIMARY KEY,
        user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await client.query('COMMIT');
    process.stdout.write('auth-svc migrations complete\n');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export { migrate };
migrate().catch((err: Error) => {
  process.stderr.write(`Migration failed: ${err.message}\n`);
  process.exit(1);
});
