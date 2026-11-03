-- convoysCfoController.addTruck has always treated vehicle_id as optional
-- (Joi .allow(null).optional(), falls back to NULL on insert) so a CFO truck
-- can be registered without first linking it to a fleet vehicle via
-- convoy_assignments. The column itself was never actually made nullable to
-- match, so every attempt to add a truck without picking a vehicle hit a raw
-- NOT NULL constraint violation instead of a clean response.
ALTER TABLE convoy_trucks ALTER COLUMN vehicle_id DROP NOT NULL;
