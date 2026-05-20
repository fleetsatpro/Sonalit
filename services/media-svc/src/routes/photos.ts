import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { query } from '../db.js';
import { config } from '../config.js';
import { NotFoundError } from '../lib/errors.js';

function buildPresignedUrl(assetId: string): { upload_url: string; expires_at: string } {
  const expires = new Date(Date.now() + 15 * 60 * 1_000);
  if (config.R2_PUBLIC_URL) {
    return { upload_url: `${config.R2_PUBLIC_URL}/upload/${assetId}?token=temp`, expires_at: expires.toISOString() };
  }
  return { upload_url: `http://localhost:${config.PORT}/v4/media/internal/upload/${assetId}`, expires_at: expires.toISOString() };
}

const CommitSchema = z.object({ asset_id: z.string().uuid() });

export const photosRoutes: FastifyPluginAsync = async (app) => {
  app.post('/v4/media/photo-upload-url', async (req, reply) => {
    const org_id = (req.headers['x-org-id'] as string) ?? '';
    const assetId = randomUUID();
    const r2Key = `orgs/${org_id}/photos/${assetId}`;
    await query(
      'INSERT INTO media_assets (id, org_id, kind, status, r2_key) VALUES ($1,$2,\'photo\',\'pending\',$3)',
      [assetId, org_id, r2Key],
    );
    const { upload_url, expires_at } = buildPresignedUrl(assetId);
    return reply.code(201).send({ asset_id: assetId, upload_url, expires_at });
  });

  app.post('/v4/media/photos/commit', async (req, reply) => {
    const org_id = (req.headers['x-org-id'] as string) ?? '';
    const { asset_id } = CommitSchema.parse(req.body);
    const { rows: [asset] } = await query('SELECT * FROM media_assets WHERE id=$1 AND org_id=$2', [asset_id, org_id]);
    if (!asset) throw new NotFoundError('Asset not found');
    const url = config.R2_PUBLIC_URL ? `${config.R2_PUBLIC_URL}/${asset.r2_key}` : `/v4/media/photos/${asset_id}`;
    const { rows: [updated] } = await query(
      'UPDATE media_assets SET status=\'committed\', url=$1, committed_at=NOW() WHERE id=$2 RETURNING *',
      [url, asset_id],
    );
    return reply.send(updated);
  });

  app.get('/v4/media/photos/:id', async (req, reply) => {
    const org_id = (req.headers['x-org-id'] as string) ?? '';
    const { id } = req.params as { id: string };
    const { rows: [row] } = await query('SELECT * FROM media_assets WHERE id=$1 AND org_id=$2 AND deleted_at IS NULL', [id, org_id]);
    if (!row) throw new NotFoundError('Asset not found');
    return reply.send(row);
  });
};
