-- last_fix_at: when the device last delivered a real GPS position, tracked
-- separately from last_seen (which advances on ANY heartbeat, fix or not).
-- The gap between the two is the GPS-jamming signature: a jammer kills the
-- satellite fix while the phone keeps its cellular link, so the device stays
-- "seen" (heartbeats land) but its position freezes. Without a distinct
-- last_fix_at we can't tell "online, GPS jammed" (a pre-hijack tell) from
-- "online and fine".
ALTER TABLE guardian_devices ADD COLUMN IF NOT EXISTS last_fix_at TIMESTAMPTZ;
