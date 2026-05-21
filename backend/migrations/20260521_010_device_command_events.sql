-- T5.3: Command lifecycle event log
CREATE TABLE IF NOT EXISTS device_command_events (
  id           SERIAL PRIMARY KEY,
  command_id   INTEGER NOT NULL REFERENCES device_commands(id) ON DELETE CASCADE,
  status       VARCHAR(20) NOT NULL,  -- issued, delivered, acked, applied, failed
  occurred_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  detail       TEXT
);

CREATE INDEX IF NOT EXISTS idx_dce_command_id ON device_command_events (command_id, occurred_at);
