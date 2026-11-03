-- convoy_route_waypoints: dispatcher-entered known towns/checkpoints along a
-- convoy's planned route (e.g. Kolwezi -> Lubumbashi -> Kasumbalesa -> ... ->
-- Dar es Salaam). Used by the daily PDF report as a fallback route display
-- when live GPS tracking (convoy_waypoints) has no pings logged for the day —
-- most convoys don't have continuous device tracking, so "no waypoints"
-- was the common case rather than the exception.
CREATE TABLE IF NOT EXISTS convoy_route_waypoints (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    convoy_id  UUID NOT NULL REFERENCES convoys(id) ON DELETE CASCADE,
    seq        INT NOT NULL,
    name       TEXT NOT NULL,
    lat        DOUBLE PRECISION,
    lng        DOUBLE PRECISION,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (convoy_id, seq)
);

CREATE INDEX IF NOT EXISTS idx_convoy_route_waypoints_convoy
    ON convoy_route_waypoints(convoy_id, seq);
