-- CDS Base Schema Migration
-- Container Delivery System - Core Tables
-- Version: 001
-- Date: 2025-01-01

BEGIN;

-- ============================================
-- CUSTOMERS
-- ============================================
CREATE TABLE IF NOT EXISTS cds_customers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
    name VARCHAR(255) NOT NULL,
    code VARCHAR(50) UNIQUE NOT NULL,
    type VARCHAR(50) NOT NULL CHECK (type IN ('importer', 'exporter', 'both')),
    contacts JSONB NOT NULL DEFAULT '[]',
    billing_address JSONB,
    delivery_addresses JSONB NOT NULL DEFAULT '[]',
    tax_id VARCHAR(100),
    credit_limit DECIMAL(12,2),
    payment_terms INTEGER,
    notes TEXT,
    tags TEXT[],
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_cds_customers_org ON cds_customers(org_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_cds_customers_code ON cds_customers(code);
CREATE INDEX idx_cds_customers_name ON cds_customers(name);

-- ============================================
-- TRANSPORTERS
-- ============================================
CREATE TABLE IF NOT EXISTS cds_transporters (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
    name VARCHAR(255) NOT NULL,
    code VARCHAR(50) UNIQUE NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'inactive')),
    contacts JSONB NOT NULL DEFAULT '[]',
    license_number VARCHAR(100),
    insurance_expiry DATE,
    rating DECIMAL(3,2),
    total_shipments INTEGER DEFAULT 0,
    on_time_delivery_rate DECIMAL(5,2),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_cds_transporters_org ON cds_transporters(org_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_cds_transporters_code ON cds_transporters(code);
CREATE INDEX idx_cds_transporters_status ON cds_transporters(status);

-- ============================================
-- CONTAINERS
-- ============================================
CREATE TABLE IF NOT EXISTS cds_containers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
    container_number VARCHAR(20) UNIQUE NOT NULL,
    iso_code VARCHAR(10) NOT NULL,
    type VARCHAR(50) NOT NULL CHECK (type IN ('20ft', '40ft', '40ft_hc', '45ft', '20ft_rf', '40ft_rf', '20ft_ot', '40ft_ot', '20ft_flat', '40ft_flat')),
    status VARCHAR(50) NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'reserved', 'in_use', 'in_transit', 'at_port', 'at_warehouse', 'at_customer', 'maintenance', 'damaged', 'retired')),
    owner_id UUID,
    tare_weight DECIMAL(8,2) NOT NULL DEFAULT 0,
    max_payload DECIMAL(8,2) NOT NULL DEFAULT 0,
    length DECIMAL(5,2) NOT NULL DEFAULT 0,
    width DECIMAL(4,2) NOT NULL DEFAULT 0,
    height DECIMAL(4,2) NOT NULL DEFAULT 0,
    volume DECIMAL(10,2) NOT NULL DEFAULT 0,
    current_shipment_id UUID,
    current_vehicle_id UUID,
    current_location JSONB,
    last_inspection DATE,
    next_inspection DATE,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_cds_containers_org ON cds_containers(org_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_cds_containers_number ON cds_containers(container_number);
CREATE INDEX idx_cds_containers_status ON cds_containers(status);
CREATE INDEX idx_cds_containers_type ON cds_containers(type);
CREATE INDEX idx_cds_containers_shipment ON cds_containers(current_shipment_id) WHERE current_shipment_id IS NOT NULL;

-- ============================================
-- DRIVERS
-- ============================================
CREATE TABLE IF NOT EXISTS cds_drivers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
    employee_id VARCHAR(50) UNIQUE NOT NULL,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    phone VARCHAR(50) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'on_trip', 'off_duty', 'suspended')),
    transporter_id UUID REFERENCES cds_transporters(id),
    license JSONB NOT NULL,
    date_of_birth DATE,
    address JSONB,
    emergency_contact JSONB,
    photo_url VARCHAR(500),
    rating DECIMAL(3,2),
    total_trips INTEGER DEFAULT 0,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_cds_drivers_org ON cds_drivers(org_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_cds_drivers_employee ON cds_drivers(employee_id);
CREATE INDEX idx_cds_drivers_email ON cds_drivers(email);
CREATE INDEX idx_cds_drivers_status ON cds_drivers(status);
CREATE INDEX idx_cds_drivers_transporter ON cds_drivers(transporter_id);

-- ============================================
-- VEHICLES
-- ============================================
CREATE TABLE IF NOT EXISTS cds_vehicles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
    registration VARCHAR(50) UNIQUE NOT NULL,
    type VARCHAR(50) NOT NULL CHECK (type IN ('truck', 'trailer', 'semi_trailer', 'rigid', 'van', 'flatbed')),
    make VARCHAR(100),
    model VARCHAR(100),
    year INTEGER,
    status VARCHAR(50) NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'on_trip', 'maintenance', 'out_of_service', 'offline')),
    transporter_id UUID REFERENCES cds_transporters(id),
    current_driver_id UUID REFERENCES cds_drivers(id),
    current_shipment_id UUID,
    current_location JSONB,
    last_location_update TIMESTAMPTZ,
    fuel_type VARCHAR(50),
    fuel_capacity DECIMAL(8,2),
    current_fuel_level DECIMAL(8,2),
    mileage INTEGER,
    next_service DATE,
    insurance_expiry DATE,
    road_tax_expiry DATE,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_cds_vehicles_org ON cds_vehicles(org_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_cds_vehicles_registration ON cds_vehicles(registration);
CREATE INDEX idx_cds_vehicles_status ON cds_vehicles(status);
CREATE INDEX idx_cds_vehicles_type ON cds_vehicles(type);
CREATE INDEX idx_cds_vehicles_transporter ON cds_vehicles(transporter_id);

-- ============================================
-- ELECTRONIC LOCKS
-- ============================================
CREATE TABLE IF NOT EXISTS cds_locks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
    serial_number VARCHAR(100) UNIQUE NOT NULL,
    securisat_id VARCHAR(100) UNIQUE NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'assigned', 'in_use', 'offline', 'low_battery', 'tampered', 'faulty', 'maintenance')),
    assigned_shipment_id UUID,
    assigned_vehicle_id UUID,
    current_location JSONB,
    last_location_update TIMESTAMPTZ,
    battery_level INTEGER NOT NULL DEFAULT 100,
    signal_strength INTEGER NOT NULL DEFAULT 100,
    last_heartbeat TIMESTAMPTZ,
    diagnostics JSONB NOT NULL DEFAULT '{}',
    installation_date DATE,
    last_maintenance DATE,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_cds_locks_org ON cds_locks(org_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_cds_locks_serial ON cds_locks(serial_number);
CREATE INDEX idx_cds_locks_securisat ON cds_locks(securisat_id);
CREATE INDEX idx_cds_locks_status ON cds_locks(status);
CREATE INDEX idx_cds_locks_shipment ON cds_locks(assigned_shipment_id) WHERE assigned_shipment_id IS NOT NULL;

-- ============================================
-- LOCK EVENTS
-- ============================================
CREATE TABLE IF NOT EXISTS cds_lock_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lock_id UUID NOT NULL REFERENCES cds_locks(id),
    type VARCHAR(50) NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    location JSONB,
    battery_level INTEGER,
    signal_strength INTEGER,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_cds_lock_events_lock ON cds_lock_events(lock_id);
CREATE INDEX idx_cds_lock_events_type ON cds_lock_events(type);
CREATE INDEX idx_cds_lock_events_timestamp ON cds_lock_events(timestamp DESC);
CREATE INDEX idx_cds_lock_events_lock_time ON cds_lock_events(lock_id, timestamp DESC);

-- ============================================
-- SHIPMENTS
-- ============================================
CREATE TABLE IF NOT EXISTS cds_shipments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
    reference VARCHAR(50) UNIQUE NOT NULL,
    customer_id UUID NOT NULL REFERENCES cds_customers(id),
    transporter_id UUID REFERENCES cds_transporters(id),
    container_id UUID REFERENCES cds_containers(id),
    vehicle_id UUID REFERENCES cds_vehicles(id),
    driver_id UUID REFERENCES cds_drivers(id),
    lock_id UUID REFERENCES cds_locks(id),
    status VARCHAR(50) NOT NULL DEFAULT 'created' CHECK (status IN (
        'created', 'assigned', 'container_assigned', 'vehicle_assigned', 'driver_assigned',
        'lock_assigned', 'tracking_activated', 'in_transit', 'at_checkpoint', 'at_border',
        'arrived', 'unlock_authorized', 'delivered', 'container_returned', 'closed', 'archived', 'cancelled'
    )),
    priority VARCHAR(20) NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'critical')),
    origin JSONB NOT NULL,
    destination JSONB NOT NULL,
    origin_coords JSONB NOT NULL,
    destination_coords JSONB NOT NULL,
    expected_pickup TIMESTAMPTZ,
    actual_pickup TIMESTAMPTZ,
    expected_delivery TIMESTAMPTZ,
    actual_delivery TIMESTAMPTZ,
    cargo_description TEXT,
    weight DECIMAL(10,2),
    value DECIMAL(12,2),
    checkpoints JSONB NOT NULL DEFAULT '[]',
    current_location JSONB,
    route_geometry TEXT,
    estimated_arrival TIMESTAMPTZ,
    delay_minutes INTEGER DEFAULT 0,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_cds_shipments_org ON cds_shipments(org_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_cds_shipments_reference ON cds_shipments(reference);
CREATE INDEX idx_cds_shipments_status ON cds_shipments(status);
CREATE INDEX idx_cds_shipments_customer ON cds_shipments(customer_id);
CREATE INDEX idx_cds_shipments_transporter ON cds_shipments(transporter_id);
CREATE INDEX idx_cds_shipments_container ON cds_shipments(container_id);
CREATE INDEX idx_cds_shipments_vehicle ON cds_shipments(vehicle_id);
CREATE INDEX idx_cds_shipments_driver ON cds_shipments(driver_id);
CREATE INDEX idx_cds_shipments_lock ON cds_shipments(lock_id);
CREATE INDEX idx_cds_shipments_priority ON cds_shipments(priority);
CREATE INDEX idx_cds_shipments_expected_delivery ON cds_shipments(expected_delivery);

-- ============================================
-- SHIPMENT TIMELINE
-- ============================================
CREATE TABLE IF NOT EXISTS cds_shipment_timeline (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shipment_id UUID NOT NULL REFERENCES cds_shipments(id),
    status VARCHAR(50) NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    user_id UUID,
    notes TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_cds_shipment_timeline_shipment ON cds_shipment_timeline(shipment_id);
CREATE INDEX idx_cds_shipment_timeline_timestamp ON cds_shipment_timeline(timestamp DESC);

-- ============================================
-- GEOFENCES
-- ============================================
CREATE TABLE IF NOT EXISTS cds_geofences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
    name VARCHAR(255) NOT NULL,
    type VARCHAR(50) NOT NULL CHECK (type IN ('circular', 'polygon', 'corridor', 'route')),
    category VARCHAR(100),
    center JSONB,
    radius DECIMAL(10,2),
    coordinates JSONB,
    corridor_width DECIMAL(8,2),
    route_geometry TEXT,
    color VARCHAR(20),
    active BOOLEAN NOT NULL DEFAULT true,
    alert_on_entry BOOLEAN NOT NULL DEFAULT true,
    alert_on_exit BOOLEAN NOT NULL DEFAULT true,
    alert_types TEXT[] NOT NULL DEFAULT '{}',
    speed_limit INTEGER,
    idle_timeout INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_cds_geofences_org ON cds_geofences(org_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_cds_geofences_type ON cds_geofences(type);
CREATE INDEX idx_cds_geofences_category ON cds_geofences(category);
CREATE INDEX idx_cds_geofences_active ON cds_geofences(active);

-- ============================================
-- GEOFENCE ALERTS
-- ============================================
CREATE TABLE IF NOT EXISTS cds_geofence_alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    geofence_id UUID NOT NULL REFERENCES cds_geofences(id),
    entity_type VARCHAR(50) NOT NULL CHECK (entity_type IN ('vehicle', 'container', 'lock')),
    entity_id UUID NOT NULL,
    shipment_id UUID REFERENCES cds_shipments(id),
    alert_type VARCHAR(50) NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    location JSONB,
    speed DECIMAL(6,2),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_cds_geofence_alerts_geofence ON cds_geofence_alerts(geofence_id);
CREATE INDEX idx_cds_geofence_alerts_entity ON cds_geofence_alerts(entity_type, entity_id);
CREATE INDEX idx_cds_geofence_alerts_type ON cds_geofence_alerts(alert_type);
CREATE INDEX idx_cds_geofence_alerts_timestamp ON cds_geofence_alerts(timestamp DESC);

-- ============================================
-- INCIDENTS
-- ============================================
CREATE TABLE IF NOT EXISTS cds_incidents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
    title VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    type VARCHAR(100) NOT NULL,
    severity VARCHAR(20) NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
    status VARCHAR(50) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'investigating', 'resolved', 'closed')),
    shipment_id UUID REFERENCES cds_shipments(id),
    vehicle_id UUID REFERENCES cds_vehicles(id),
    driver_id UUID REFERENCES cds_drivers(id),
    lock_id UUID REFERENCES cds_locks(id),
    location JSONB,
    reported_by UUID,
    assigned_to UUID,
    resolved_at TIMESTAMPTZ,
    resolution TEXT,
    attachments TEXT[],
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_cds_incidents_org ON cds_incidents(org_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_cds_incidents_status ON cds_incidents(status);
CREATE INDEX idx_cds_incidents_severity ON cds_incidents(severity);
CREATE INDEX idx_cds_incidents_type ON cds_incidents(type);
CREATE INDEX idx_cds_incidents_shipment ON cds_incidents(shipment_id);

-- ============================================
-- ALERTS
-- ============================================
CREATE TABLE IF NOT EXISTS cds_alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    type VARCHAR(100) NOT NULL,
    severity VARCHAR(20) NOT NULL CHECK (severity IN ('info', 'warning', 'error', 'critical')),
    status VARCHAR(50) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'acknowledged', 'resolved', 'dismissed')),
    source VARCHAR(50) NOT NULL CHECK (source IN ('system', 'lock', 'geofence', 'shipment', 'vehicle', 'driver')),
    source_id UUID,
    shipment_id UUID REFERENCES cds_shipments(id),
    vehicle_id UUID REFERENCES cds_vehicles(id),
    lock_id UUID REFERENCES cds_locks(id),
    acknowledged_by UUID,
    acknowledged_at TIMESTAMPTZ,
    resolved_by UUID,
    resolved_at TIMESTAMPTZ,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_cds_alerts_org ON cds_alerts(org_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_cds_alerts_status ON cds_alerts(status);
CREATE INDEX idx_cds_alerts_severity ON cds_alerts(severity);
CREATE INDEX idx_cds_alerts_type ON cds_alerts(type);
CREATE INDEX idx_cds_alerts_source ON cds_alerts(source);
CREATE INDEX idx_cds_alerts_created ON cds_alerts(created_at DESC);

-- ============================================
-- DOCUMENTS
-- ============================================
CREATE TABLE IF NOT EXISTS cds_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
    reference VARCHAR(50) UNIQUE NOT NULL,
    type VARCHAR(50) NOT NULL CHECK (type IN (
        'bill_of_lading', 'packing_list', 'invoice', 'customs_declaration',
        'certificate_of_origin', 'phytosanitary', 'insurance', 'delivery_note', 'photo', 'other'
    )),
    title VARCHAR(255) NOT NULL,
    shipment_id UUID REFERENCES cds_shipments(id),
    container_id UUID REFERENCES cds_containers(id),
    vehicle_id UUID REFERENCES cds_vehicles(id),
    file_url VARCHAR(500) NOT NULL,
    file_size BIGINT NOT NULL,
    mime_type VARCHAR(100) NOT NULL,
    uploaded_by UUID,
    verified BOOLEAN NOT NULL DEFAULT false,
    verified_by UUID,
    verified_at TIMESTAMPTZ,
    expiry_date DATE,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_cds_documents_org ON cds_documents(org_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_cds_documents_reference ON cds_documents(reference);
CREATE INDEX idx_cds_documents_type ON cds_documents(type);
CREATE INDEX idx_cds_documents_shipment ON cds_documents(shipment_id);

-- ============================================
-- AI INBOX
-- ============================================
CREATE TABLE IF NOT EXISTS cds_ai_inbox (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
    channel VARCHAR(50) NOT NULL CHECK (channel IN ('email', 'whatsapp', 'sms')),
    sender VARCHAR(255) NOT NULL,
    sender_phone VARCHAR(50),
    sender_email VARCHAR(255),
    subject VARCHAR(500),
    content TEXT NOT NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed BOOLEAN NOT NULL DEFAULT false,
    processed_at TIMESTAMPTZ,
    extracted_data JSONB,
    confidence DECIMAL(5,4),
    verified BOOLEAN NOT NULL DEFAULT false,
    verified_by UUID,
    verified_at TIMESTAMPTZ,
    committed_to_system BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_cds_ai_inbox_org ON cds_ai_inbox(org_id);
CREATE INDEX idx_cds_ai_inbox_processed ON cds_ai_inbox(processed);
CREATE INDEX idx_cds_ai_inbox_channel ON cds_ai_inbox(channel);
CREATE INDEX idx_cds_ai_inbox_received ON cds_ai_inbox(received_at DESC);

-- ============================================
-- GPS HISTORY (for tracking playback)
-- ============================================
CREATE TABLE IF NOT EXISTS cds_gps_history (
    id BIGSERIAL PRIMARY KEY,
    entity_type VARCHAR(50) NOT NULL CHECK (entity_type IN ('vehicle', 'container', 'lock')),
    entity_id UUID NOT NULL,
    shipment_id UUID REFERENCES cds_shipments(id),
    lat DECIMAL(10,7) NOT NULL,
    lng DECIMAL(11,7) NOT NULL,
    speed DECIMAL(6,2),
    heading DECIMAL(5,2),
    accuracy DECIMAL(8,2),
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_cds_gps_history_entity ON cds_gps_history(entity_type, entity_id);
CREATE INDEX idx_cds_gps_history_shipment ON cds_gps_history(shipment_id);
CREATE INDEX idx_cds_gps_history_timestamp ON cds_gps_history(timestamp DESC);
CREATE INDEX idx_cds_gps_history_entity_time ON cds_gps_history(entity_type, entity_id, timestamp DESC);

-- Partition by month (optional for large datasets)
-- See migration 002 for partitioning setup

-- ============================================
-- AUDIT LOGS
-- ============================================
CREATE TABLE IF NOT EXISTS cds_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
    user_id UUID,
    user_email VARCHAR(255),
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(100) NOT NULL,
    entity_id UUID,
    old_data JSONB,
    new_data JSONB,
    ip_address INET,
    user_agent TEXT,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    metadata JSONB DEFAULT '{}'
);

CREATE INDEX idx_cds_audit_logs_org ON cds_audit_logs(org_id);
CREATE INDEX idx_cds_audit_logs_user ON cds_audit_logs(user_id);
CREATE INDEX idx_cds_audit_logs_entity ON cds_audit_logs(entity_type, entity_id);
CREATE INDEX idx_cds_audit_logs_action ON cds_audit_logs(action);
CREATE INDEX idx_cds_audit_logs_timestamp ON cds_audit_logs(timestamp DESC);

-- ============================================
-- NOTIFICATIONS
-- ============================================
CREATE TABLE IF NOT EXISTS cds_notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    org_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    type VARCHAR(100) NOT NULL,
    read BOOLEAN NOT NULL DEFAULT false,
    data JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_cds_notifications_user ON cds_notifications(user_id, read);
CREATE INDEX idx_cds_notifications_created ON cds_notifications(created_at DESC);

-- ============================================
-- NOTIFICATION SUBSCRIPTIONS
-- ============================================
CREATE TABLE IF NOT EXISTS cds_notification_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    org_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
    channel VARCHAR(50) NOT NULL CHECK (channel IN ('in_app', 'email', 'sms', 'whatsapp', 'push')),
    event_type VARCHAR(100) NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_cds_notification_subscriptions_user ON cds_notification_subscriptions(user_id, channel);

-- ============================================
-- IDEMPOTENCY KEYS
-- ============================================
CREATE TABLE IF NOT EXISTS cds_idempotency_keys (
    key VARCHAR(255) PRIMARY KEY,
    org_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
    status_code INTEGER NOT NULL,
    response_body JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '24 hours'
);

CREATE INDEX idx_cds_idempotency_keys_expires ON cds_idempotency_keys(expires_at);

-- ============================================
-- REFRESH TOKENS
-- ============================================
CREATE TABLE IF NOT EXISTS cds_refresh_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    token_hash VARCHAR(255) NOT NULL UNIQUE,
    user_agent TEXT,
    ip_address INET,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at TIMESTAMPTZ
);

CREATE INDEX idx_cds_refresh_tokens_user ON cds_refresh_tokens(user_id);
CREATE INDEX idx_cds_refresh_tokens_hash ON cds_refresh_tokens(token_hash);
CREATE INDEX idx_cds_refresh_tokens_expires ON cds_refresh_tokens(expires_at);

COMMIT;
