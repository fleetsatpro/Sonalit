import { pool } from '../db.js';

export async function migrate(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(`
      CREATE TABLE IF NOT EXISTS rules (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id        UUID NOT NULL,
        name          TEXT NOT NULL,
        description   TEXT,
        condition_type TEXT NOT NULL CHECK (condition_type IN ('speed','geofence','idle','battery')),
        threshold     NUMERIC NOT NULL,
        action_type   TEXT NOT NULL CHECK (action_type IN ('alert','notify')),
        enabled       BOOLEAN NOT NULL DEFAULT TRUE,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at    TIMESTAMPTZ
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS rules_org_enabled_idx ON rules (org_id, enabled)
        WHERE deleted_at IS NULL
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS alerts (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id        UUID NOT NULL,
        type          TEXT NOT NULL,
        severity      TEXT NOT NULL CHECK (severity IN ('low','medium','high','critical')),
        title         TEXT NOT NULL,
        description   TEXT,
        status        TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','acknowledged','resolved','suppressed')),
        vehicle_id    UUID,
        driver_id     UUID,
        metadata      JSONB NOT NULL DEFAULT '{}',
        notes         TEXT,
        rule_id       UUID REFERENCES rules(id),
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at    TIMESTAMPTZ
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS alerts_org_status_idx ON alerts (org_id, status)
        WHERE deleted_at IS NULL
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS alerts_org_severity_idx ON alerts (org_id, severity)
        WHERE deleted_at IS NULL
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS incidents (
        id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id         UUID NOT NULL,
        title          TEXT NOT NULL,
        description    TEXT,
        severity       TEXT NOT NULL CHECK (severity IN ('low','medium','high','critical')),
        status         TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','investigating','resolved')),
        assigned_to_id UUID,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at     TIMESTAMPTZ
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS incidents_org_status_idx ON incidents (org_id, status)
        WHERE deleted_at IS NULL
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS incident_actions (
        id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        incident_id  UUID NOT NULL REFERENCES incidents(id),
        action_type  TEXT NOT NULL,
        notes        TEXT,
        actor_id     UUID NOT NULL,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS incident_actions_incident_idx
        ON incident_actions (incident_id)
    `);

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
