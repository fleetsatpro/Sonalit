import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { config } from '../config.js';
import { deviceAuth } from '../middleware/deviceAuth.js';
import { withOrgContext } from '../db.js';

const GpsFixSchema = z.object({
  seq_no: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  alt_m: z.number().optional(),
  accuracy_m: z.number().min(0).max(100000).optional(),
  speed_kmh: z.number().min(0).max(1000).optional(),
  heading_deg: z.number().min(0).max(360).optional(),
  timestamp: z.string().datetime().refine(
    (value) => !/\.\d{7,}Z$/.test(value),
    { message: 'Timestamp precision must not exceed PostgreSQL microseconds' },
  ),
  hdop: z.number().min(0).max(1000).optional(),
  satellites: z.number().int().min(0).max(32767).optional(),
});

const BatchBodySchema = z.object({
  device_id: z.string().uuid(),
  org_id: z.string().uuid(),
  fixes: z.array(GpsFixSchema).min(1).max(50),
});

type BatchBody = z.infer<typeof BatchBodySchema>;

function normalizeTimestamp(value: string): string {
  // PostgreSQL stores timestamps to microsecond precision. Preserve all allowed
  // digits instead of Date.toISOString(), which silently truncates microseconds.
  const match = /^(\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2})(?:\\.(\\d+))?Z$/.exec(value);
  if (!match) return value; // Zod validation rejects unsupported timestamp forms first.
  return `${match[1]}.${(match[2] ?? '').padEnd(6, '0')}Z`;
}

interface PersistedGpsFix {
  seq_no: string | number;
  lat: number;
  lon: number;
  alt_m: number | null;
  accuracy_m: number | null;
  speed_kmh: number | null;
  heading_deg: number | null;
  hdop: number | null;
  satellites: number | null;
  timestamp: string;
}
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

      // Canonicalize timestamps at microsecond precision so distinct device fixes
      // are not silently collapsed by JavaScript Date's millisecond precision.
      const byIdentity = new Map<string, GpsFixInput>();
      let duplicateInRequest = 0;
      for (const fix of fixes) {
        const normalized = { ...fix, timestamp: normalizeTimestamp(fix.timestamp) };
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
      let result: { accepted: number; duplicate: number };
      try {
        result = await withOrgContext(org_id, async (client) => {
          const inserted = await client.query<PersistedGpsFix>(
            `WITH input AS (
               SELECT $1::uuid AS org_id, $2::uuid AS device_id,
                      f.seq_no, f.lat, f.lng, f.alt_m, f.accuracy_m, f.speed_kmh,
                      f.heading_deg, f.timestamp AS time, f.hdop, f.satellites
               FROM jsonb_to_recordset($3::jsonb) AS f(
                 seq_no bigint, lat double precision, lng double precision,
                 alt_m real, accuracy_m real, speed_kmh real, heading_deg real,
                 timestamp timestamptz, hdop real, satellites smallint
               )
             )
             INSERT INTO gps_fixes
               (time, device_id, org_id, lat, lon, alt_m, accuracy_m, speed_kmh,
                heading_deg, hdop, satellites, seq_no)
             SELECT time, device_id, org_id, lat, lng, alt_m, accuracy_m, speed_kmh,
                    heading_deg, hdop, satellites, seq_no
               FROM input
             ON CONFLICT (device_id, seq_no, time) DO NOTHING
             RETURNING seq_no, lat, lon, alt_m, accuracy_m, speed_kmh, heading_deg,
                       hdop, satellites,
                       to_char(time AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS timestamp`,
            [org_id, device_id, JSON.stringify(uniqueFixes)],
          );

          // Re-read in a new statement snapshot. Exact retries are safe, but the
          // same identity with different measurements (including another org)
          // is a data-integrity conflict and rolls back this entire batch.
          const conflicts = await client.query(
            `WITH input AS (
               SELECT f.seq_no, f.lat, f.lng, f.alt_m, f.accuracy_m, f.speed_kmh,
                      f.heading_deg, f.timestamp AS time, f.hdop, f.satellites
               FROM jsonb_to_recordset($3::jsonb) AS f(
                 seq_no bigint, lat double precision, lng double precision,
                 alt_m real, accuracy_m real, speed_kmh real, heading_deg real,
                 timestamp timestamptz, hdop real, satellites smallint
               )
             )
             SELECT i.seq_no
               FROM input i
               JOIN gps_fixes stored
                 ON stored.device_id = $2::uuid
                AND stored.seq_no = i.seq_no
                AND stored.time = i.time
              WHERE stored.org_id IS DISTINCT FROM $1::uuid
                 OR stored.lat IS DISTINCT FROM i.lat
                 OR stored.lon IS DISTINCT FROM i.lng
                 OR stored.alt_m IS DISTINCT FROM i.alt_m
                 OR stored.accuracy_m IS DISTINCT FROM i.accuracy_m
                 OR stored.speed_kmh IS DISTINCT FROM i.speed_kmh
                 OR stored.heading_deg IS DISTINCT FROM i.heading_deg
                 OR stored.hdop IS DISTINCT FROM i.hdop
                 OR stored.satellites IS DISTINCT FROM i.satellites
              LIMIT 1`,
            [org_id, device_id, JSON.stringify(uniqueFixes)],
          );
          if (conflicts.rows.length) throw new Error('telemetry_identity_conflict');

          const outboxEvents = inserted.rows.map((fix) => {
            const seqNo = Number(fix.seq_no);
            return {
              seq_no: seqNo,
              timestamp: fix.timestamp,
              payload: {
                device_id,
                org_id,
                seq_no: seqNo,
                lat: fix.lat,
                lng: fix.lon,
                alt_m: fix.alt_m,
                accuracy_m: fix.accuracy_m,
                speed_kmh: fix.speed_kmh,
                heading_deg: fix.heading_deg,
                timestamp: fix.timestamp,
                hdop: fix.hdop,
                satellites: fix.satellites,
              },
            };
          });

          const enqueued = await client.query(
            `INSERT INTO telemetry_ingest_outbox
               (org_id, device_id, seq_no, time, subject, payload, message_id)
             SELECT $1::uuid, $2::uuid, f.seq_no, f.timestamp::timestamptz,
                    'telemetry.gps.' || $1::text || '.' || $2::text,
                    f.payload,
                    $2::text || ':' || f.seq_no::text || ':' ||
                      ((extract(epoch FROM f.timestamp::timestamptz) * 1000000)::bigint)::text
               FROM jsonb_to_recordset($3::jsonb) AS f(
                 seq_no bigint, timestamp text, payload jsonb
               )
             RETURNING id`,
            [org_id, device_id, JSON.stringify(outboxEvents)],
          );
          if ((enqueued.rowCount ?? 0) !== inserted.rows.length) {
            throw new Error('telemetry_outbox_cardinality_mismatch');
          }

          const accepted = inserted.rows.length;
          return {
            accepted,
            duplicate: duplicateInRequest + uniqueFixes.length - accepted,
          };
        });
      } catch (err) {
        if (err instanceof Error && err.message === 'telemetry_identity_conflict') {
          return reply.status(409).send({
            code: 'TELEMETRY_IDENTITY_CONFLICT',
            message: 'A previously recorded device sequence/timestamp has different telemetry. No fixes from this batch were accepted.',
          });
        }
        throw err;
      }

      // HTTP 202 is emitted only after raw GPS and all publication intents commit.
      return reply.status(202).send({ ...result, durable: true });
    },
  );
}
