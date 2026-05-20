import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { query } from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const MonthSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/).default(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }),
});

const TransactionSchema = MonthSchema.extend({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const CreateTransactionSchema = z.object({
  category: z.enum(['fuel', 'maintenance', 'toll', 'insurance', 'salary', 'other']),
  amount: z.number(),
  description: z.string().max(500).optional(),
  vehicle_id: z.string().uuid().optional(),
  driver_id: z.string().uuid().optional(),
  transaction_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const financeRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth(app));

  app.get('/v4/finance/summary', async (req, reply) => {
    const { org_id } = (req as typeof req & { user: { org_id: string } }).user;
    const { month } = MonthSchema.parse(req.query);
    const [year, mon] = month.split('-');
    const { rows } = await query<{ category: string; total: string }>(
      `SELECT category, SUM(amount)::numeric AS total
       FROM finance_records
       WHERE org_id = $1
         AND EXTRACT(YEAR FROM transaction_date) = $2
         AND EXTRACT(MONTH FROM transaction_date) = $3
         AND deleted_at IS NULL
       GROUP BY category`,
      [org_id, year, mon],
    );
    const summary: Record<string, number> = {};
    for (const r of rows) summary[r.category] = parseFloat(r.total);
    return reply.send({ month, summary });
  });

  app.get('/v4/finance/transactions', async (req, reply) => {
    const { org_id } = (req as typeof req & { user: { org_id: string } }).user;
    const q = TransactionSchema.parse(req.query);
    const [year, mon] = q.month.split('-');
    const offset = (q.page - 1) * q.limit;
    const { rows } = await query(
      `SELECT * FROM finance_records
       WHERE org_id = $1
         AND EXTRACT(YEAR FROM transaction_date) = $2
         AND EXTRACT(MONTH FROM transaction_date) = $3
         AND deleted_at IS NULL
       ORDER BY transaction_date DESC
       LIMIT $4 OFFSET $5`,
      [org_id, year, mon, q.limit, offset],
    );
    return reply.send({ data: rows });
  });

  app.post('/v4/finance/transactions', async (req, reply) => {
    const { org_id } = (req as typeof req & { user: { org_id: string } }).user;
    const body = CreateTransactionSchema.parse(req.body);
    const { rows: [row] } = await query(
      `INSERT INTO finance_records (id, org_id, category, amount, description, vehicle_id, driver_id, transaction_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [randomUUID(), org_id, body.category, body.amount, body.description ?? null, body.vehicle_id ?? null, body.driver_id ?? null, body.transaction_date],
    );
    return reply.code(201).send(row);
  });
};
