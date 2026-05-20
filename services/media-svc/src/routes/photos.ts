import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { query } from '../db.js';
import { config } from '../config.js';
import { AuthError, NotFoundError } from '../lib/errors.js';

const PRESIGN_TTL_S = 900; // 15 min

function buildS3Client(): S3Client | null {
  if (!config.R2_ACCOUNT_ID || !config.R2_ACCESS_KEY || !config.R2_SECRET_KEY || !config.R2_BUCKET) {
    return null;
  }
  return new S3Client({
    region: 'auto',
    endpoint: `https://${config.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: config.R2_ACCESS_KEY,
      secretAccessKey: config.R2_SECRET_KEY,
    },
  });
}

const s3 = buildS3Client();

async function buildPresignedUploadUrl(r2Key: string): Promise<{ upload_url: string; expires_at: string }> {
  const expires = new Date(Date.now() + PRESIGN_TTL_S * 1_000);
  if (s3 && config.R2_BUCKET) {
    const cmd = new PutObjectCommand({ Bucket: config.R2_BUCKET, Key: r2Key, ContentType: 'image/jpeg' });
    const upload_url = await getSignedUrl(s3, cmd, { expiresIn: PRESIGN_TTL_S });
    return { upload_url, expires_at: expires.toISOString() };
  }
  return {
    upload_url: `http://localhost:${config.PORT}/v4/media/internal/upload/${r2Key}`,
    expires_at: expires.toISOString(),
  };
}

const CommitSchema = z.object({ asset_id: z.string().uuid() });

export const photosRoutes: FastifyPluginAsync = async (app) => {
  app.post('/v4/media/photo-upload-url', async (req, reply) => {
    const org_id = (req.headers['x-org-id'] as string | undefined)?.trim();
    if (!org_id) throw new AuthError('x-org-id header required');
    const assetId = randomUUID();
    const r2Key = `orgs/${org_id}/photos/${assetId}`;
    await query(
      `INSERT INTO media_assets (id, org_id, kind, status, r2_key) VALUES ($1,$2,'photo','pending',$3)`,
      [assetId, org_id, r2Key],
    );
    const { upload_url, expires_at } = await buildPresignedUploadUrl(r2Key);
    return reply.code(201).send({ asset_id: assetId, upload_url, expires_at });
  });

  app.post('/v4/media/photos/commit', async (req, reply) => {
    const org_id = (req.headers['x-org-id'] as string | undefined)?.trim();
    if (!org_id) throw new AuthError('x-org-id header required');
    const { asset_id } = CommitSchema.parse(req.body);
    const [asset] = await query<{ id: string; r2_key: string; status: string }>(
      'SELECT id, r2_key, status FROM media_assets WHERE id=$1 AND org_id=$2',
      [asset_id, org_id],
    );
    if (!asset) throw new NotFoundError('Asset not found');
    const url = config.R2_PUBLIC_URL ? `${config.R2_PUBLIC_URL}/${asset.r2_key}` : `/v4/media/photos/${asset_id}`;
    const [updated] = await query(
      `UPDATE media_assets SET status='committed', url=$1, committed_at=NOW() WHERE id=$2 RETURNING *`,
      [url, asset_id],
    );
    return reply.send(updated);
  });

  app.get('/v4/media/photos/:id', async (req, reply) => {
    const org_id = (req.headers['x-org-id'] as string | undefined)?.trim();
    if (!org_id) throw new AuthError('x-org-id header required');
    const { id } = req.params as { id: string };
    const [row] = await query(
      'SELECT * FROM media_assets WHERE id=$1 AND org_id=$2 AND deleted_at IS NULL',
      [id, org_id],
    );
    if (!row) throw new NotFoundError('Asset not found');
    return reply.send(row);
  });
};
