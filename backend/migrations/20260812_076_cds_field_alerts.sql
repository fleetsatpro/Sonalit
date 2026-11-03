-- Extend cds_alerts.type CHECK to allow yard/port field-team events.
-- 'container_clamped'   — Yard clamped an e-lock onto a booking container
-- 'container_delivered' — Port unclamped the e-lock; container delivered
ALTER TABLE cds_alerts DROP CONSTRAINT IF EXISTS cds_alerts_type_check;
ALTER TABLE cds_alerts ADD CONSTRAINT cds_alerts_type_check
  CHECK (type IN ('overspeed','route_deviation','lock_tamper','device_offline',
    'unauthorized_stop','late_delivery','fuel_theft','geofence_exit',
    'battery_low','sos','harsh_braking','harsh_acceleration',
    'container_clamped','container_delivered'));
