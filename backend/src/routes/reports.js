const router = require('express').Router();
const Joi = require('joi');
const PDFDocument = require('pdfkit');
const { authenticate } = require('../middleware/auth');
const { attachOrgDb } = require('../utils/orgScopedDb');
const { asyncHandler } = require('../middleware/error');

router.use(authenticate, attachOrgDb);

// attachOrgDb only sets req.db when req.user.org_id is present. Fail closed
// rather than let a request fall through to an unscoped connection — see
// the geofences.js router for the RLS-bypass mechanics this guards against.
router.use((req, res, next) => {
  if (!req.db) return res.status(403).json({ error: 'org_scope_required' });
  next();
});

const REPORT_TYPES = ['fleet', 'convoy', 'driver', 'daily_ops', 'sla_compliance', 'fuel_efficiency'];

const generateSchema = Joi.object({
  type: Joi.string().valid(...REPORT_TYPES).required(),
  from: Joi.string().isoDate(),
  to: Joi.string().isoDate(),
  format: Joi.string().valid('PDF', 'CSV').default('PDF'),
});

function titleFor(type, from, to) {
  const range = from && to ? ` (${from} – ${to})` : '';
  const labels = {
    fleet: 'Fleet Status Report',
    convoy: 'Convoy Activity Report',
    driver: 'Driver Performance Report',
    daily_ops: 'Daily Operations Report',
    sla_compliance: 'SLA Compliance Report',
    fuel_efficiency: 'Fuel Efficiency Report',
  };
  return `${labels[type] ?? type} Report${range}`;
}

// Runs the aggregation query for a report type against the caller's
// org-scoped connection (RLS on vehicles/convoys/drivers filters by org
// automatically), returning the row set + a summary block.
async function buildReportData(db, type, from, to) {
  const range = [from || '1970-01-01', to || '2999-12-31'];

  if (type === 'fleet') {
    const { rows } = await db(
      `SELECT registration, type, status, region FROM vehicles WHERE deleted_at IS NULL ORDER BY registration`,
    );
    const summary = rows.reduce((acc, v) => { acc[v.status] = (acc[v.status] || 0) + 1; return acc; }, {});
    return { rows, summary, columns: ['registration', 'type', 'status', 'region'] };
  }

  if (type === 'convoy') {
    const { rows } = await db(
      `SELECT name, region, status, priority, departure_time, arrival_time, estimated_arrival
         FROM convoys
        WHERE deleted_at IS NULL
          AND (departure_time IS NULL OR departure_time BETWEEN $1 AND $2)
        ORDER BY departure_time DESC NULLS LAST`,
      range,
    );
    const completed = rows.filter(r => r.status === 'completed' && r.arrival_time);
    const onTime = completed.filter(r => r.estimated_arrival && new Date(r.arrival_time) <= new Date(r.estimated_arrival));
    const summary = {
      total: rows.length,
      completed: completed.length,
      on_time_pct: completed.length ? Math.round((onTime.length / completed.length) * 100) : null,
    };
    return { rows, summary, columns: ['name', 'region', 'status', 'priority', 'departure_time', 'arrival_time', 'estimated_arrival'] };
  }

  if (type === 'driver') {
    const { rows } = await db(
      `SELECT name, employee_id, status, driver_score, total_trips, total_km, harsh_braking_count, speeding_count
         FROM drivers WHERE deleted_at IS NULL ORDER BY driver_score DESC`,
    );
    const summary = {
      total: rows.length,
      avg_score: rows.length ? Math.round(rows.reduce((s, r) => s + r.driver_score, 0) / rows.length) : null,
    };
    return { rows, summary, columns: ['name', 'employee_id', 'status', 'driver_score', 'total_trips', 'total_km', 'harsh_braking_count', 'speeding_count'] };
  }

  if (type === 'daily_ops') {
    const d = to || new Date().toISOString().slice(0, 10);
    const [v, c, a] = await Promise.all([
      db("SELECT COUNT(*) total, COUNT(*) FILTER (WHERE status='active') active FROM vehicles WHERE deleted_at IS NULL"),
      db("SELECT COUNT(*) total, COUNT(*) FILTER (WHERE status='active') active FROM convoys WHERE deleted_at IS NULL"),
      db("SELECT COUNT(*) total, COUNT(*) FILTER (WHERE severity='critical') critical FROM alerts WHERE DATE(created_at)=$1 AND deleted_at IS NULL", [d]),
    ]);
    const summary = { date: d, vehicles: v.rows[0], convoys: c.rows[0], alerts: a.rows[0] };
    return { rows: [summary], summary, columns: Object.keys(summary) };
  }

  if (type === 'sla_compliance') {
    const { rows } = await db(
      "SELECT COUNT(*) total_completed, COUNT(*) FILTER (WHERE arrival_time <= estimated_arrival) on_time FROM convoys WHERE status='completed' AND arrival_time IS NOT NULL AND deleted_at IS NULL",
    );
    const row = rows[0];
    const summary = { ...row, sla_pct: row.total_completed > 0 ? Math.round((row.on_time / row.total_completed) * 100) : 100 };
    return { rows: [summary], summary, columns: Object.keys(summary) };
  }

  // fuel_efficiency
  const { rows } = await db(
    `SELECT v.registration, AVG(f.fuel_level) avg_fuel
       FROM vehicles v JOIN fuel_logs f ON f.vehicle_id = v.id
      GROUP BY v.id, v.registration ORDER BY avg_fuel ASC LIMIT 20`,
  );
  return { rows, summary: { vehicle_count: rows.length }, columns: ['registration', 'avg_fuel'] };
}

function toCsv(rows, columns) {
  const esc = (v) => {
    if (v == null) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [columns.join(',')];
  for (const row of rows) lines.push(columns.map(c => esc(row[c])).join(','));
  return lines.join('\n');
}

function toPdf(res, title, summary, rows, columns) {
  const doc = new PDFDocument({ margin: 40, size: 'A4' });
  res.setHeader('Content-Type', 'application/pdf');
  doc.pipe(res);

  doc.fontSize(16).text(title, { align: 'left' });
  doc.moveDown(0.3);
  doc.fontSize(9).fillColor('#666').text(`Generated ${new Date().toLocaleString()}`);
  doc.moveDown(1);

  doc.fillColor('#000').fontSize(10);
  const summaryLine = Object.entries(summary || {})
    .filter(([, v]) => typeof v !== 'object')
    .map(([k, v]) => `${k}: ${v}`).join('   ');
  if (summaryLine) { doc.text(summaryLine); doc.moveDown(1); }

  const colWidth = (doc.page.width - 80) / Math.max(columns.length, 1);
  const rowHeight = 18;

  const drawHeader = () => {
    doc.fontSize(9).fillColor('#fff');
    doc.rect(40, doc.y, doc.page.width - 80, rowHeight).fill('#333');
    let x = 40;
    doc.fillColor('#fff');
    for (const col of columns) { doc.text(col, x + 4, doc.y + 5, { width: colWidth - 8, height: rowHeight }); x += colWidth; }
    doc.moveDown(1.3);
  };

  drawHeader();
  doc.fontSize(8).fillColor('#000');
  for (const row of rows) {
    if (doc.y > doc.page.height - 60) { doc.addPage(); drawHeader(); doc.fontSize(8).fillColor('#000'); }
    const y = doc.y;
    let x = 40;
    for (const col of columns) {
      const v = row[col];
      doc.text(v == null ? '—' : String(v), x + 4, y, { width: colWidth - 8 });
      x += colWidth;
    }
    doc.moveDown(0.9);
  }

  if (rows.length === 0) doc.fontSize(9).fillColor('#888').text('No data for this period.');
  doc.end();
}

// GET /reports — list this org's generated reports
router.get('/', asyncHandler(async (req, res) => {
  const limit = Math.min(200, parseInt(req.query.limit) || 50);
  const result = await req.db(
    `SELECT id, type, title, format, status, period_from, period_to, created_at AS generated_at
       FROM reports ORDER BY created_at DESC LIMIT $1`,
    [limit],
  );
  res.json({ data: result.rows });
}));

// POST /reports — generate a report synchronously and store its data
router.post('/', asyncHandler(async (req, res) => {
  const { error, value } = generateSchema.validate(req.body);
  if (error) return res.status(400).json({ error: error.message });

  const { type, from, to, format } = value;
  const { rows, summary } = await buildReportData(req.db, type, from, to);
  const title = titleFor(type, from, to);

  const result = await req.db(
    `INSERT INTO reports (org_id, type, title, data, format, status, period_from, period_to, created_by)
     VALUES ((current_setting('app.current_org_id',true))::uuid, $1, $2, $3, $4, 'ready', $5, $6, $7)
     RETURNING id, type, title, format, status, period_from, period_to, created_at AS generated_at`,
    [type, title, JSON.stringify({ rows, summary }), format, from || null, to || null, req.user.id],
  );
  res.status(201).json({ data: result.rows[0] });
}));

// GET /reports/:id — single report with its stored data
router.get('/:id', asyncHandler(async (req, res) => {
  const result = await req.db(
    `SELECT id, type, title, data, format, status, period_from, period_to, created_at AS generated_at FROM reports WHERE id=$1`,
    [req.params.id],
  );
  if (!result.rows.length) return res.status(404).json({ error: 'Not found' });
  res.json({ data: result.rows[0] });
}));

// GET /reports/:id/export — stream the stored report as CSV or PDF
router.get('/:id/export', asyncHandler(async (req, res) => {
  const result = await req.db(`SELECT * FROM reports WHERE id=$1`, [req.params.id]);
  if (!result.rows.length) return res.status(404).json({ error: 'Not found' });
  const report = result.rows[0];
  const data = typeof report.data === 'string' ? JSON.parse(report.data) : report.data;
  const rows = data?.rows ?? [];
  const columns = rows.length ? Object.keys(rows[0]) : [];
  const filename = report.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase();

  if (report.format === 'CSV') {
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
    return res.send(toCsv(rows, columns));
  }

  res.setHeader('Content-Disposition', `attachment; filename="${filename}.pdf"`);
  toPdf(res, report.title, data?.summary, rows, columns);
}));

// DELETE /reports/:id
router.delete('/:id', asyncHandler(async (req, res) => {
  const result = await req.db(`DELETE FROM reports WHERE id=$1 RETURNING id`, [req.params.id]);
  if (!result.rows.length) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
}));

module.exports = router;
