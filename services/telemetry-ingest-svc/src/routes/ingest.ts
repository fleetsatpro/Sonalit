import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { StringCodec } from 'nats';
import { z } from 'zod';
import { getJs } from '../nats.js';
import { dedupFixes, type GpsFix } from '../lib/dedup.js';
import { enqueueMessage } from '../lib/ringBuffer.js';
import { config } from '../config.js';

const GpsFixSchema = z.object({
  seq_no: z.number().int().nonnegative(),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  alt_m: z.number().optional(),
  accuracy_m: z.number().optional(),
  speed_kmh: z.number().optional(),
  heading_deg: z.number().min(0).max(360).optional(),
  timestamp: z.string().datetime(),
  hdop: z.number().optional(),
  satellites: z.number().int().optional(),
});

const BatchBodySchema = z.object({
  device_id: z.string().uuid(),
  org_id: z.string().uuid(),
  fixes: z.array(GpsFixSchema).min(1).max(50),
});

type BatchBody = z.infer<typeof BatchBodySchema>;
type GpsFixInput = z.infer<typeof GpsFixSchema>;

const sc = StringCodec();

async function publishFix(
  orgId: string,
  deviceId: string,
  fix: GpsFixInput & GpsFix,
): Promise<void> {
  const subject = `telemetry.gps.${orgId}.${deviceId}`;
  const payload = JSON.stringify({ device_id: deviceId, org_id: orgId, ...fix });
  const msgId = `${deviceId}:${fix.seq_no}`;

  try {
    const js = getJs();
    await js.publish(subject, sc.encode(payload), { msgID: msgId });
  } catch {
    enqueueMessage(subject, payload, msgId);
  }
}

export async function ingestRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: BatchBody }>(
    '/v4/telemetry/batch',
    {
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

      const { device_id, org_id, fixes } = parseResult.data;

      const { accepted, duplicateCount } = await dedupFixes(
        device_id,
        fixes as (GpsFixInput & GpsFix)[],
      );

      await Promise.all(
        accepted.map((fix) => publishFix(org_id, device_id, fix)),
      );

      return reply.status(202).send({
        accepted: accepted.length,
        duplicate: duplicateCount,
      });
    },
  );
}
