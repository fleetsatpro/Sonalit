const router = require('express').Router();
const { authenticate, authorize } = require('../../../sonalit-fixed/backend/src/middleware/auth');
const { query } = require('../../../sonalit-fixed/backend/src/config/database');

router.use(authenticate);

// GET /finance/dashboard
router.get('/dashboard', async (req, res, next) => {
  try {
    const [invoices, expenses, tripCosts] = await Promise.all([
      query(`SELECT
        COUNT(*) total_invoices,
        SUM(total) FILTER (WHERE status='paid') revenue_collected,
        SUM(total) FILTER (WHERE status='sent') revenue_pending,
        SUM(total) FILTER (WHERE status='overdue') revenue_overdue,
        COUNT(*) FILTER (WHERE status='overdue') overdue_count
        FROM invoices`),
      query(`SELECT
        SUM(amount) total_expenses,
        SUM(amount) FILTER (WHERE category='fuel') fuel_costs,
        SUM(amount) FILTER (WHERE category='maintenance') maintenance_costs,
        SUM(amount) FILTER (WHERE category='toll') toll_costs,
        SUM(amount) FILTER (WHERE category='driver_allowance') allowances
        FROM expenses WHERE expense_date > NOW() - INTERVAL '30 days'`),
      query(`SELECT
        COUNT(*) total_trips,
        SUM(distance_km) total_km,
        SUM(fuel_used) total_fuel_used,
        AVG(fuel_used/NULLIF(distance_km,0)*100) avg_fuel_per_100km,
        SUM(cost_usd) total_trip_cost
        FROM trips WHERE started_at > NOW() - INTERVAL '30 days'`),
    ]);
    res.json({ data: {
      invoices: invoices.rows[0],
      expenses: expenses.rows[0],
      trips: tripCosts.rows[0],
    }});
  } catch (err) { next(err); }
});

// GET /finance/invoices
router.get('/invoices', async (req, res, next) => {
  try {
    const { status, limit = 50, offset = 0 } = req.query;
    const params = [limit, offset];
    const where = status ? `AND status=$3` : '';
    if (status) params.push(status);
    const result = await query(
      `SELECT * FROM invoices WHERE 1=1 ${where} ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      params
    );
    res.json({ data: result.rows });
  } catch (err) { next(err); }
});

// POST /finance/invoices
router.post('/invoices', authorize('admin', 'dispatcher'), async (req, res, next) => {
  try {
    const { shipment_id, customer_name, customer_email, line_items = [], due_date, notes } = req.body;
    if (!customer_name || !line_items.length) return res.status(400).json({ error: 'customer_name and line_items required' });
    const subtotal = line_items.reduce((s, item) => s + (item.quantity * item.unit_price), 0);
    const tax_rate = 0.16;
    const tax_amount = subtotal * tax_rate;
    const total = subtotal + tax_amount;
    const invoice_number = `INV-${Date.now().toString(36).toUpperCase()}`;
    const result = await query(
      `INSERT INTO invoices (invoice_number, shipment_id, customer_name, customer_email, subtotal, tax_rate, tax_amount, total, line_items, due_date, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [invoice_number, shipment_id||null, customer_name, customer_email, subtotal, tax_rate, tax_amount, total, JSON.stringify(line_items), due_date, notes, req.user.id]
    );
    res.status(201).json({ data: result.rows[0] });
  } catch (err) { next(err); }
});

// GET /finance/expenses
router.get('/expenses', async (req, res, next) => {
  try {
    const { vehicle_id, category, limit = 100 } = req.query;
    const filters = ['1=1'];
    const params = [];
    if (vehicle_id) { params.push(vehicle_id); filters.push(`e.vehicle_id=$${params.length}`); }
    if (category) { params.push(category); filters.push(`e.category=$${params.length}`); }
    params.push(limit);
    const result = await query(
      `SELECT e.*, v.registration, d.name AS driver_name FROM expenses e
       LEFT JOIN vehicles v ON v.id=e.vehicle_id LEFT JOIN drivers d ON d.id=e.driver_id
       WHERE ${filters.join(' AND ')} ORDER BY e.expense_date DESC LIMIT $${params.length}`,
      params
    );
    res.json({ data: result.rows });
  } catch (err) { next(err); }
});

// POST /finance/expenses
router.post('/expenses', async (req, res, next) => {
  try {
    const { trip_id, vehicle_id, driver_id, category, amount, currency = 'USD', description, expense_date } = req.body;
    if (!category || !amount) return res.status(400).json({ error: 'category and amount required' });
    const result = await query(
      'INSERT INTO expenses (trip_id, vehicle_id, driver_id, category, amount, currency, description, expense_date, recorded_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',
      [trip_id||null, vehicle_id||null, driver_id||null, category, amount, currency, description, expense_date||new Date(), req.user.id]
    );
    res.status(201).json({ data: result.rows[0] });
  } catch (err) { next(err); }
});

// GET /finance/profitability
router.get('/profitability', async (req, res, next) => {
  try {
    const result = await query(`
      SELECT
        v.registration,
        v.type,
        v.region,
        COUNT(t.id) trips,
        SUM(t.distance_km) total_km,
        SUM(t.cost_usd) total_cost,
        SUM(e.amount) FILTER (WHERE e.vehicle_id = v.id) total_expenses,
        SUM(i.total) FILTER (WHERE i.id IS NOT NULL) total_revenue,
        ROUND((SUM(i.total) - SUM(t.cost_usd) - COALESCE(SUM(e.amount),0))::numeric, 2) profit
      FROM vehicles v
      LEFT JOIN trips t ON t.vehicle_id = v.id AND t.started_at > NOW() - INTERVAL '30 days'
      LEFT JOIN expenses e ON e.vehicle_id = v.id AND e.expense_date > NOW() - INTERVAL '30 days'
      LEFT JOIN shipments s ON s.vehicle_id = v.id
      LEFT JOIN invoices i ON i.shipment_id = s.id AND i.status = 'paid'
      WHERE v.deleted_at IS NULL
      GROUP BY v.id, v.registration, v.type, v.region
      ORDER BY profit DESC NULLS LAST
      LIMIT 20
    `);
    res.json({ data: result.rows });
  } catch (err) { next(err); }
});

module.exports = router;
