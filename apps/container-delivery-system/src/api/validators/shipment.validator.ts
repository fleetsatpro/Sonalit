// Shipment Validators

import Joi from 'joi';

export const createShipmentSchema = Joi.object({
  reference: Joi.string().required().max(50),
  customerId: Joi.string().uuid().required(),
  transporterId: Joi.string().uuid(),
  origin: Joi.object({
    street: Joi.string().optional(),
    city: Joi.string().required(),
    state: Joi.string().optional(),
    country: Joi.string().required(),
    postalCode: Joi.string().optional(),
  }).required(),
  destination: Joi.object({
    street: Joi.string().optional(),
    city: Joi.string().required(),
    state: Joi.string().optional(),
    country: Joi.string().required(),
    postalCode: Joi.string().optional(),
  }).required(),
  originCoords: Joi.object({
    lat: Joi.number().min(-90).max(90).required(),
    lng: Joi.number().min(-180).max(180).required(),
  }).required(),
  destinationCoords: Joi.object({
    lat: Joi.number().min(-90).max(90).required(),
    lng: Joi.number().min(-180).max(180).required(),
  }).required(),
  expectedPickup: Joi.date().iso().optional(),
  expectedDelivery: Joi.date().iso().optional(),
  cargoDescription: Joi.string().max(500).optional(),
  weight: Joi.number().positive().optional(),
  value: Joi.number().positive().optional(),
  priority: Joi.string().valid('low', 'medium', 'high', 'critical').default('medium'),
  notes: Joi.string().max(1000).optional(),
});

export const updateShipmentSchema = Joi.object({
  transporterId: Joi.string().uuid().optional().allow(null),
  containerId: Joi.string().uuid().optional().allow(null),
  vehicleId: Joi.string().uuid().optional().allow(null),
  driverId: Joi.string().uuid().optional().allow(null),
  lockId: Joi.string().uuid().optional().allow(null),
  status: Joi.string().valid(
    'created', 'assigned', 'container_assigned', 'vehicle_assigned', 'driver_assigned',
    'lock_assigned', 'tracking_activated', 'in_transit', 'at_checkpoint', 'at_border',
    'arrived', 'unlock_authorized', 'delivered', 'container_returned', 'closed', 'archived', 'cancelled'
  ).optional(),
  priority: Joi.string().valid('low', 'medium', 'high', 'critical').optional(),
  expectedPickup: Joi.date().iso().optional().allow(null),
  expectedDelivery: Joi.date().iso().optional().allow(null),
  actualPickup: Joi.date().iso().optional().allow(null),
  actualDelivery: Joi.date().iso().optional().allow(null),
  currentLocation: Joi.object({
    lat: Joi.number().min(-90).max(90).required(),
    lng: Joi.number().min(-180).max(180).required(),
  }).optional().allow(null),
  routeGeometry: Joi.string().optional().allow(null),
  estimatedArrival: Joi.date().iso().optional().allow(null),
  delayMinutes: Joi.number().integer().min(0).optional(),
  notes: Joi.string().max(1000).optional().allow(null),
});

export const shipmentStatusTransitionSchema = Joi.object({
  status: Joi.string().valid(
    'assigned', 'container_assigned', 'vehicle_assigned', 'driver_assigned',
    'lock_assigned', 'tracking_activated', 'in_transit', 'at_checkpoint', 'at_border',
    'arrived', 'unlock_authorized', 'delivered', 'container_returned', 'closed', 'archived', 'cancelled'
  ).required(),
  notes: Joi.string().max(500).optional(),
  metadata: Joi.object().optional(),
});

export const addCheckpointSchema = Joi.object({
  name: Joi.string().required().max(255),
  location: Joi.object({
    lat: Joi.number().min(-90).max(90).required(),
    lng: Joi.number().min(-180).max(180).required(),
  }).required(),
  address: Joi.object({
    street: Joi.string().optional(),
    city: Joi.string().optional(),
    state: Joi.string().optional(),
    country: Joi.string().optional(),
    postalCode: Joi.string().optional(),
  }).optional(),
  expectedArrival: Joi.date().iso().optional(),
});

export const verifyCheckpointSchema = Joi.object({
  verified: Joi.boolean().required(),
  notes: Joi.string().max(500).optional(),
});

export const shipmentQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  pageSize: Joi.number().integer().min(1).max(100).default(20),
  status: Joi.string().valid(
    'created', 'assigned', 'container_assigned', 'vehicle_assigned', 'driver_assigned',
    'lock_assigned', 'tracking_activated', 'in_transit', 'at_checkpoint', 'at_border',
    'arrived', 'unlock_authorized', 'delivered', 'container_returned', 'closed', 'archived', 'cancelled'
  ).optional(),
  priority: Joi.string().valid('low', 'medium', 'high', 'critical').optional(),
  customerId: Joi.string().uuid().optional(),
  transporterId: Joi.string().uuid().optional(),
  containerId: Joi.string().uuid().optional(),
  vehicleId: Joi.string().uuid().optional(),
  driverId: Joi.string().uuid().optional(),
  search: Joi.string().max(100).optional(),
  sortBy: Joi.string().valid('createdAt', 'expectedDelivery', 'priority', 'status').default('createdAt'),
  sortOrder: Joi.string().valid('asc', 'desc').default('desc'),
  dateFrom: Joi.date().iso().optional(),
  dateTo: Joi.date().iso().optional(),
});
