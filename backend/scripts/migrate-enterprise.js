require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const { pool } = require('../../src/config/database');

async function migrateEnterprise() {
  const client = await pool.connect();
  try {
    console.log('🚀 Enterprise migration starting...');
    await client.query('BEGIN');

    // ── Drivers table ──────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS drivers (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id UUID REFERENCES users(id),
        org_id UUID DEFAULT '00000000-0000-0000-0000-000000000001',
        name VARCHAR(255) NOT NULL,
        employee_id VARCHAR(100) UNIQUE,
        phone VARCHAR(30),
        email VARCHAR(255),
        license_number VARCHAR(100),
        license_class VARCHAR(50),
        license_expiry TIMESTAMPTZ,
        certifications JSONB DEFAULT '[]',
        status VARCHAR(50) DEFAULT 'active' CHECK (status IN ('active','inactive','suspended','on_leave')),
        current_vehicle_id UUID REFERENCES vehicles(id),
        driver_score INTEGER DEFAULT 100,
        total_trips INTEGER DEFAULT 0,
        total_km DECIMAL(12,2) DEFAULT 0,
        harsh_braking_count INTEGER DEFAULT 0,
        speeding_count INTEGER DEFAULT 0,
        idling_minutes INTEGER DEFAULT 0,
        photo_url VARCHAR(500),
        notes TEXT,
        hired_date TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS idx_drivers_org ON drivers(org_id) WHERE deleted_at IS NULL;
      CREATE INDEX IF NOT EXISTS idx_drivers_status ON drivers(status) WHERE deleted_at IS NULL;
      CREATE INDEX IF NOT EXISTS idx_drivers_score ON drivers(driver_score DESC);
    `);

    // ── Shipments table ────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS shipments (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        org_id UUID DEFAULT '00000000-0000-0000-0000-000000000001',
        tracking_number VARCHAR(100) UNIQUE NOT NULL,
        convoy_id UUID REFERENCES convoys(id),
        vehicle_id UUID REFERENCES vehicles(id),
        driver_id UUID REFERENCES drivers(id),
        customer_name VARCHAR(255),
        customer_ref VARCHAR(100),
        status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending','picked_up','in_transit','at_checkpoint','delivered','failed','returned')),
        priority VARCHAR(50) DEFAULT 'standard' CHECK (priority IN ('standard','express','critical','hazmat','cold_chain')),
        origin_address TEXT,
        origin_lat DECIMAL(10,7),
        origin_lng DECIMAL(10,7),
        destination_address TEXT,
        destination_lat DECIMAL(10,7),
        destination_lng DECIMAL(10,7),
        cargo_description TEXT,
        cargo_weight_kg DECIMAL(10,2),
        cargo_volume_m3 DECIMAL(10,3),
        cargo_value DECIMAL(14,2),
        currency VARCHAR(10) DEFAULT 'USD',
        requires_temp_control BOOLEAN DEFAULT false,
        temp_min DECIMAL(5,2),
        temp_max DECIMAL(5,2),
        is_hazmat BOOLEAN DEFAULT false,
        hazmat_class VARCHAR(50),
        seal_number VARCHAR(100),
        scheduled_pickup TIMESTAMPTZ,
        actual_pickup TIMESTAMPTZ,
        scheduled_delivery TIMESTAMPTZ,
        actual_delivery TIMESTAMPTZ,
        estimated_arrival TIMESTAMPTZ,
        pod_signature VARCHAR(500),
        pod_notes TEXT,
        pod_at TIMESTAMPTZ,
        cost_usd DECIMAL(10,2),
        distance_km DECIMAL(8,2),
        notes TEXT,
        metadata JSONB DEFAULT '{}',
        created_by UUID REFERENCES users(id),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS idx_shipments_org ON shipments(org_id, status) WHERE deleted_at IS NULL;
      CREATE INDEX IF NOT EXISTS idx_shipments_tracking ON shipments(tracking_number);
      CREATE INDEX IF NOT EXISTS idx_shipments_convoy ON shipments(convoy_id) WHERE deleted_at IS NULL;
    `);

    // ── Checkpoints ────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS checkpoints (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        shipment_id UUID REFERENCES shipments(id),
        convoy_id UUID REFERENCES convoys(id),
        name VARCHAR(255) NOT NULL,
        location_name VARCHAR(255),
        lat DECIMAL(10,7),
        lng DECIMAL(10,7),
        sequence_order INTEGER DEFAULT 0,
        status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending','reached','skipped','delayed')),
        expected_at TIMESTAMPTZ,
        reached_at TIMESTAMPTZ,
        delay_minutes INTEGER DEFAULT 0,
        notes TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_checkpoints_shipment ON checkpoints(shipment_id);
    `);

    // ── Trips ──────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS trips (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        org_id UUID DEFAULT '00000000-0000-0000-0000-000000000001',
        vehicle_id UUID NOT NULL REFERENCES vehicles(id),
        driver_id UUID REFERENCES drivers(id),
        convoy_id UUID REFERENCES convoys(id),
        shipment_id UUID REFERENCES shipments(id),
        status VARCHAR(50) DEFAULT 'active' CHECK (status IN ('active','completed','aborted')),
        start_lat DECIMAL(10,7),
        start_lng DECIMAL(10,7),
        end_lat DECIMAL(10,7),
        end_lng DECIMAL(10,7),
        start_address TEXT,
        end_address TEXT,
        started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        ended_at TIMESTAMPTZ,
        distance_km DECIMAL(8,2) DEFAULT 0,
        duration_minutes INTEGER DEFAULT 0,
        avg_speed DECIMAL(6,2) DEFAULT 0,
        max_speed DECIMAL(6,2) DEFAULT 0,
        fuel_used DECIMAL(8,2),
        fuel_cost DECIMAL(8,2),
        harsh_braking_count INTEGER DEFAULT 0,
        speeding_violations INTEGER DEFAULT 0,
        idle_minutes INTEGER DEFAULT 0,
        route_deviation_km DECIMAL(6,2) DEFAULT 0,
        driver_score INTEGER DEFAULT 100,
        cost_usd DECIMAL(10,2),
        notes TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_trips_vehicle ON trips(vehicle_id, started_at DESC);
      CREATE INDEX IF NOT EXISTS idx_trips_driver ON trips(driver_id, started_at DESC);
      CREATE INDEX IF NOT EXISTS idx_trips_org ON trips(org_id, started_at DESC);
    `);

    // ── Financial: Invoices ────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS invoices (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        org_id UUID DEFAULT '00000000-0000-0000-0000-000000000001',
        invoice_number VARCHAR(100) UNIQUE NOT NULL,
        shipment_id UUID REFERENCES shipments(id),
        trip_id UUID REFERENCES trips(id),
        customer_name VARCHAR(255) NOT NULL,
        customer_email VARCHAR(255),
        status VARCHAR(50) DEFAULT 'draft' CHECK (status IN ('draft','sent','paid','overdue','cancelled')),
        subtotal DECIMAL(12,2) NOT NULL DEFAULT 0,
        tax_rate DECIMAL(5,4) DEFAULT 0.0,
        tax_amount DECIMAL(12,2) DEFAULT 0,
        total DECIMAL(12,2) NOT NULL DEFAULT 0,
        currency VARCHAR(10) DEFAULT 'USD',
        line_items JSONB DEFAULT '[]',
        due_date TIMESTAMPTZ,
        paid_at TIMESTAMPTZ,
        notes TEXT,
        created_by UUID REFERENCES users(id),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_invoices_org ON invoices(org_id, status);
    `);

    // ── Expenses ───────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS expenses (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        org_id UUID DEFAULT '00000000-0000-0000-0000-000000000001',
        trip_id UUID REFERENCES trips(id),
        vehicle_id UUID REFERENCES vehicles(id),
        driver_id UUID REFERENCES drivers(id),
        category VARCHAR(100) NOT NULL CHECK (category IN ('fuel','maintenance','toll','permit','driver_allowance','other')),
        amount DECIMAL(10,2) NOT NULL,
        currency VARCHAR(10) DEFAULT 'USD',
        description TEXT,
        receipt_url VARCHAR(500),
        recorded_by UUID REFERENCES users(id),
        expense_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_expenses_trip ON expenses(trip_id);
      CREATE INDEX IF NOT EXISTS idx_expenses_vehicle ON expenses(vehicle_id, expense_date DESC);
    `);

    // ── Maintenance records ────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS maintenance_records (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        org_id UUID DEFAULT '00000000-0000-0000-0000-000000000001',
        vehicle_id UUID NOT NULL REFERENCES vehicles(id),
        type VARCHAR(100) NOT NULL CHECK (type IN ('scheduled','breakdown','inspection','recall','upgrade')),
        title VARCHAR(255) NOT NULL,
        description TEXT,
        status VARCHAR(50) DEFAULT 'scheduled' CHECK (status IN ('scheduled','in_progress','completed','cancelled')),
        priority VARCHAR(50) DEFAULT 'medium' CHECK (priority IN ('low','medium','high','critical')),
        odometer_at_service DECIMAL(10,2),
        engine_hours_at_service DECIMAL(10,2),
        cost DECIMAL(10,2),
        parts JSONB DEFAULT '[]',
        workshop VARCHAR(255),
        technician VARCHAR(255),
        scheduled_at TIMESTAMPTZ,
        started_at TIMESTAMPTZ,
        completed_at TIMESTAMPTZ,
        next_service_km DECIMAL(10,2),
        next_service_date TIMESTAMPTZ,
        created_by UUID REFERENCES users(id),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_maint_vehicle ON maintenance_records(vehicle_id, scheduled_at DESC);
      CREATE INDEX IF NOT EXISTS idx_maint_status ON maintenance_records(status) WHERE status != 'completed';
    `);

    // ── Risk zones ─────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS risk_zones (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        org_id UUID DEFAULT '00000000-0000-0000-0000-000000000001',
        name VARCHAR(255) NOT NULL,
        description TEXT,
        risk_level VARCHAR(50) DEFAULT 'medium' CHECK (risk_level IN ('low','medium','high','critical','no_go')),
        zone_type VARCHAR(100) DEFAULT 'general' CHECK (zone_type IN ('conflict','theft_hotspot','flood','road_closed','customs','checkpoint','restricted','no_go')),
        lat DECIMAL(10,7) NOT NULL,
        lng DECIMAL(10,7) NOT NULL,
        radius_km DECIMAL(6,2) DEFAULT 5,
        polygon JSONB,
        active BOOLEAN DEFAULT true,
        valid_from TIMESTAMPTZ,
        valid_until TIMESTAMPTZ,
        source VARCHAR(100),
        created_by UUID REFERENCES users(id),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_risk_zones_active ON risk_zones(risk_level) WHERE active = true;
    `);

    // ── Notifications ──────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        org_id UUID DEFAULT '00000000-0000-0000-0000-000000000001',
        user_id UUID REFERENCES users(id),
        type VARCHAR(100) NOT NULL,
        title VARCHAR(255) NOT NULL,
        body TEXT NOT NULL,
        data JSONB DEFAULT '{}',
        channel VARCHAR(50) DEFAULT 'in_app' CHECK (channel IN ('in_app','email','sms','push')),
        read_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_notifs_user ON notifications(user_id, read_at) WHERE read_at IS NULL;
    `);

    // ── Driver events ──────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS driver_events (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        driver_id UUID NOT NULL REFERENCES drivers(id),
        vehicle_id UUID REFERENCES vehicles(id),
        trip_id UUID REFERENCES trips(id),
        event_type VARCHAR(100) NOT NULL CHECK (event_type IN ('harsh_braking','harsh_acceleration','speeding','idling','geofence_breach','fatigue_alert','phone_use','seatbelt','sos')),
        severity VARCHAR(50) DEFAULT 'medium',
        lat DECIMAL(10,7),
        lng DECIMAL(10,7),
        speed DECIMAL(6,2),
        score_impact INTEGER DEFAULT 0,
        details JSONB DEFAULT '{}',
        timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_driver_events_driver ON driver_events(driver_id, timestamp DESC);
    `);

    // ── Add columns to existing tables ────────────────────────────────
    await client.query(`
      ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS driver_id UUID REFERENCES drivers(id);
      ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS assigned_driver VARCHAR(255);
      ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS make VARCHAR(100);
      ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS model VARCHAR(100);
      ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS year INTEGER;
      ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS vin VARCHAR(50);
      ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS color VARCHAR(50);
      ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS insurance_expiry TIMESTAMPTZ;
      ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS inspection_expiry TIMESTAMPTZ;
      ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS purchase_date TIMESTAMPTZ;
      ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS purchase_cost DECIMAL(12,2);
      ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS current_value DECIMAL(12,2);
      ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS heading DECIMAL(6,2) DEFAULT 0;
      ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS altitude DECIMAL(8,2);
      ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS cargo_capacity_kg DECIMAL(8,2);
    `);

    // ── Performance indexes ────────────────────────────────────────────
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_gps_vehicle_time_new ON gps_logs(vehicle_id, timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_alerts_severity ON alerts(severity, created_at DESC) WHERE deleted_at IS NULL;
      CREATE INDEX IF NOT EXISTS idx_convoys_status_new ON convoys(status, region) WHERE deleted_at IS NULL;
    `);

    await client.query('COMMIT');
    console.log('✅ Enterprise migration complete');
    console.log('   ✓ drivers table');
    console.log('   ✓ shipments table');
    console.log('   ✓ checkpoints table');
    console.log('   ✓ trips table');
    console.log('   ✓ invoices table');
    console.log('   ✓ expenses table');
    console.log('   ✓ maintenance_records table');
    console.log('   ✓ risk_zones table');
    console.log('   ✓ notifications table');
    console.log('   ✓ driver_events table');
    console.log('   ✓ 15 vehicle columns added');
    console.log('   ✓ 6 performance indexes added');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Migration failed:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

migrateEnterprise().catch(e => { console.error(e.message); process.exit(1); });
