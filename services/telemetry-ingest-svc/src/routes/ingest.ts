import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { config } from '../config.js';
import { deviceAuth } from '../middleware/deviceAuth.js';
import { withOrgContext } from '../db.js';
import { withOrgContext } from '../db.js';

const GpsFixSchema = z.object({
  seq_no: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  alt_m: z.number().optional(),
  accuracy_m: z.number().min(0).max(100000).optional(),
  speed_kmh: z.number().min(0).max(1000).optional(),
  heading_deg: z.number().min(0).max(360).optional(),
  timestamp: z.string().datetime(),
  hdop: z.number().min(0).max(1000).optional(),
  satellites: z.number().int().min(0).max(32767).optional(),
});

const BatchBodySchema = z.object({
  device_id: z.string().uuid(),
  org_id: z.string().uuid(),
  fixes: z.array(GpsFixSchema).min(1).max(50),
});

type BatchBody = z.infer<typeof BatchBodySchema>;
type GpsFixInput = z.infer<typeof GpsFixSchema>;

export async function ingestRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: BatchBody }>(
    '/v4/telemetry/batch',
    { preHandler: deviceAuth,
      config: { rateLimit: { max: 1000, timeWindow: '1 minute', keyGenerator: (req: FastifyRequest) => req.headers['x-device-token'] as string ?? req.ip } },
      schema: {
        body: {
          type: 'object',
          required: ['device_id', 'org_id', 'fixes'],
          properties: {
            device_id: { type: 'string', format: 'uuid' },
            org_id: { type: 'string', format: 'uuid' },
            fixes: {
              type: 'array',
              minItems: 1,
              maxItems: config.MAX_BATCH_SIZE,
              items: { type: 'object' },
            },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Body: BatchBody }>, reply: FastifyReply) => {
      const parseResult = BatchBodySchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: parseResult.error.issues[0]?.message ?? 'Invalid request body',
        });
      }

      const { device_id, org_id: requestedOrgId, fixes } = parseResult.data;
      const authenticatedDevice = request.telemetryDevice;
      if (!authenticatedDevice) return reply.status(401).send({ code: 'AUTH_REQUIRED', message: 'Device authentication required' });
      if (device_id !== authenticatedDevice.id) return reply.status(403).send({ code: 'DEVICE_SCOPE_MISMATCH', message: 'device_id does not match authenticated device' });
      if (requestedOrgId !== authenticatedDevice.org_id) return reply.status(403).send({ code: 'ORG_SCOPE_MISMATCH', message: 'org_id does not match authenticated device' });
      const org_id = authenticatedDevice.org_id;

      // Collapse identical retries inside this request. If one identity carries
      // conflicting content, reject the batch rather than arbitrarily choosing a fix.
      const byIdentity = new Map<string, GpsFixInput>();
      let duplicateInRequest = 0;
      for (const fix of fixes) {
        const normalized = { ...fix, timestamp: new Date(fix.timestamp).toISOString() };
        const identity = `${normalized.seq_no}:${normalized.timestamp}`;
        const previous = byIdentity.get(identity);
        if (previous) {
          if (JSON.stringify(previous) !== JSON.stringify(normalized)) {
            return reply.status(400).send({
              code: 'CONFLICTING_DUPLICATE_FIX',
              message: 'A device sequence/timestamp identity has conflicting telemetry in this batch',
            });
          }
          duplicateInRequest++;
          continue;
        }
        byIdentity.set(identity, normalized);
      }
      const uniqueFixes = [...byIdentity.values()];
      const result = await withOrgContext(org_id, async (client) => {
        // Raw observations and publication intent commit in one database transaction.
        const persisted = await client.query<{ accepted: number | string }>(
          `WITH input AS (
             SELECT $1::uuid AS org_id, $2::uuid AS device_id,
                    f.seq_no, f.lat, f.lng, f.alt_m, f.accuracy_m, f.speed_kmh,
                    f.heading_deg, f.timestamp AS time, f.hdop, f.satellites
             FROM jsonb_to_recordset($3::jsonb) AS f(
               seq_no bigint, lat double precision, lng double precision,
               alt_m real, accuracy_m real, speed_kmh real, heading_deg real,
               timestamp timestamptz, hdop real, satellites smallint
             )
           ),
           inserted AS (
             INSERT INTO gps_fixes
               (time, device_id, org_id, lat, lon, alt_m, accuracy_m, speed_kmh,
                heading_deg, hdop, satellites, seq_no)
             SELECT time, device_id, org_id, lat, lng, alt_m, accuracy_m, speed_kmh,
                    heading_deg, hdop, satellites, seq_no
               FROM input
             ON CONFLICT (device_id, seq_no, time) DO NOTHING
             RETURNING time, device_id, org_id, lat, lon, alt_m, accuracy_m,
                       speed_kmh, heading_deg, hdop, satellites, seq_no
           ),
           enqueued AS (
             INSERT INTO telemetry_ingest_outbox
               (org_id, device_id, seq_no, time, subject, payload, message_id)
             SELECT org_id, device_id, seq_no, time,
                    'telemetry.gps.' || org_id::text || '.' || device_id::text,
                    jsonb_build_object(
                      'device_id', device_id, 'org_id', org_id, 'seq_no', seq_no,
                      'lat', lat, 'lng', lon, 'alt_m', alt_m, 'accuracy_m', accuracy_m,
                      'speed_kmh', speed_kmh, 'heading_deg', heading_deg,
                      'timestamp', to_char(time AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
                      'hdop', hdop, 'satellites', satellites
                    ),
                    device_id::text || ':' || seq_no::text || ':' ||
                      ((extract(epoch FROM time) * 1000000)::bigint)::text
               FROM inserted
             RETURNING id
           )
           SELECT COUNT(*)::int AS accepted FROM enqueued`,
          [org_id, device_id, JSON.stringify(uniqueFixes)],
        );
        const accepted = Number(persisted.rows[0]?.accepted ?? 0);
        return { accepted, duplicate: duplicateInRequest + uniqueFixes.length - accepted };
      });
      // HTTP 202 is emitted only after PostgreSQL has committed the fix and outbox entry.
      return reply.status(202).send({ ...result, durable: true });
    },
  );
}
