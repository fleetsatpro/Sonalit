import { StringCodec } from 'nats';
import { getJs } from '../nats.js';
import { query } from '../db.js';
import pino from 'pino';
const log = pino({ level: process.env['LOG_LEVEL'] ?? 'info' });

type GenerateJob = { report_id: string; org_id: string; type: string; from: string; to: string; format: string };

function generateCSV(headers: string[], rows: Record<string, unknown>[]): string {
  const escape = (v: unknown): string => `"${String(v ?? '').replace(/"/g, '""')}"`;
  return [headers.join(','), ...rows.map(r => headers.map(h => escape(r[h])).join(','))].join('\n');
}

async function generateReport(job: GenerateJob): Promise<string> {
  const { rows } = await query(
    `SELECT * FROM ${job.type === 'fleet' ? 'vehicles' : job.type === 'driver' ? 'drivers' : 'convoys'}
     WHERE org_id = $1 AND created_at >= $2 AND created_at <= $3 AND deleted_at IS NULL
     LIMIT 1000`,
    [job.org_id, job.from, job.to],
  );
  if (job.format === 'csv') {
    const headers = rows.length ? Object.keys(rows[0] as object) : ['id'];
    const csv = generateCSV(headers, rows as Record<string, unknown>[]);
    return `data:text/csv;base64,${Buffer.from(csv).toString('base64')}`;
  }
  const html = `<html><body><h1>${job.type} report</h1><p>${job.from} – ${job.to}</p><pre>${JSON.stringify(rows, null, 2)}</pre></body></html>`;
  return `data:text/html;base64,${Buffer.from(html).toString('base64')}`;
}

export async function startGenerateConsumer(): Promise<void> {
  const js = getJs(); const sc = StringCodec();
  const consumer = await js.consumers.get('REPORTS', 'reports-generate');
  const messages = await consumer.consume();
  log.info('reports-svc generate consumer started');
  for await (const msg of messages) {
    try {
      const job = JSON.parse(sc.decode(msg.data)) as GenerateJob;
      const url = await generateReport(job);
      await query('UPDATE reports SET status=\'ready\', url=$1, completed_at=NOW() WHERE id=$2', [url, job.report_id]);
      msg.ack();
    } catch (err) {
      log.error({ err }, 'Generate consumer error');
      const job = JSON.parse(sc.decode(msg.data)) as GenerateJob;
      await query('UPDATE reports SET status=\'failed\' WHERE id=$1', [job.report_id]).catch(() => {});
      msg.nak();
    }
  }
}
