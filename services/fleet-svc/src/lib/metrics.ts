import { register, collectDefaultMetrics, Counter, Histogram } from 'prom-client';

collectDefaultMetrics({ register });

export const vehicleOpsCounter = new Counter({
  name: 'fleet_vehicle_ops_total',
  help: 'Total vehicle CRUD operations',
  labelNames: ['operation', 'result'] as const,
  registers: [register],
});

export const driverOpsCounter = new Counter({
  name: 'fleet_driver_ops_total',
  help: 'Total driver CRUD operations',
  labelNames: ['operation', 'result'] as const,
  registers: [register],
});

export const shipmentOpsCounter = new Counter({
  name: 'fleet_shipment_ops_total',
  help: 'Total shipment CRUD operations',
  labelNames: ['operation', 'result'] as const,
  registers: [register],
});

export const messagePublishedCounter = new Counter({
  name: 'fleet_messages_published_total',
  help: 'Total messages published to NATS',
  labelNames: ['result'] as const,
  registers: [register],
});

export const maintenanceOpsCounter = new Counter({
  name: 'fleet_maintenance_ops_total',
  help: 'Total maintenance record operations',
  labelNames: ['operation', 'result'] as const,
  registers: [register],
});

export const httpRequestDuration = new Histogram({
  name: 'fleet_http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status_code'] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
  registers: [register],
});

export { register };
