-- convoy_waypoints: GPS route checkpoints logged by Guardian devices during active convoys
CREATE TABLE IF NOT EXISTS convoy_waypoints (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    convoy_id UUID NOT NULL REFERENCES convoys(id) ON DELETE CASCADE,
    guardian_device_id UUID REFERENCES guardian_devices(id),
    lat DOUBLE PRECISION NOT NULL,
    lng DOUBLE PRECISION NOT NULL,
    speed_kmh FLOAT,
    heading FLOAT,
    accuracy_m FLOAT,
    recorded_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_convoy_waypoints_convoy_time
    ON convoy_waypoints(convoy_id, recorded_at);

-- convoy_seals: RFID seal tracking per truck per session per report day
CREATE TABLE IF NOT EXISTS convoy_seals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    convoy_id UUID NOT NULL REFERENCES convoys(id) ON DELETE CASCADE,
    convoy_truck_id UUID NOT NULL REFERENCES convoy_trucks(id) ON DELETE CASCADE,
    seal_position TEXT NOT NULL,
    rfid_code TEXT NOT NULL,
    session TEXT NOT NULL CHECK (session IN ('sod','eod')),
    status TEXT NOT NULL DEFAULT 'intact'
        CHECK (status IN ('intact','broken','missing','replaced')),
    report_date DATE NOT NULL,
    cfo_user_id UUID REFERENCES users(id),
    guardian_device_id UUID REFERENCES guardian_devices(id),
    photo_url TEXT,
    notes TEXT,
    scanned_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (convoy_truck_id, seal_position, report_date, session)
);

CREATE INDEX IF NOT EXISTS idx_convoy_seals_convoy_date
    ON convoy_seals(convoy_id, report_date);

-- cfo_login_attempts: brute-force protection for CFO device login
CREATE TABLE IF NOT EXISTS cfo_login_attempts (
    device_id UUID PRIMARY KEY,
    attempts INTEGER NOT NULL DEFAULT 0,
    window_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    locked_until TIMESTAMPTZ
);
