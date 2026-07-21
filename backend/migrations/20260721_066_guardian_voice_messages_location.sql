-- Record-time location for field-officer voice notes. POST /guardian/voice-message
-- already computes the officer's fix (device GPS at record time, falling back to
-- last known position) to broadcast on the realtime event; persisting it here lets
-- the homepage's poll-based backstop fly the globe to the exact spot a note was
-- recorded even when the live websocket event was missed (tab unfocused, brief
-- disconnect). Nullable — older rows and notes sent with no fix stay NULL.
ALTER TABLE guardian_voice_messages ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION;
ALTER TABLE guardian_voice_messages ADD COLUMN IF NOT EXISTS lng DOUBLE PRECISION;
