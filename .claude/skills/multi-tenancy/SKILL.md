---
name: multi-tenancy
description: "MANDATORY SAFETY SKILL — PostgreSQL Row-Level Security, org-scoped queries, and tenant isolation. Must be loaded for any database or API operation involving tenant-owned data."
triggers:
  - database
  - query
  - table
  - migration
  - org
  - tenant
  - RLS
  - row level security
  - org_id
  - req.db
  - CRUD
related_skills:
  - database-migrations
  - backend-patterns
  - auth-security
---

# Multi-Tenancy — MANDATORY SAFETY SKILL

## Purpose

Prevent cross-tenant data leaks. This is the single most dangerous class of bug in Sonalit. Every database operation that touches tenant-owned data must go through the org-scoped query path.

**This skill is MANDATORY for any work involving database tables, API routes that read/write data, or migrations.**

## When to Activate

Automatically for ANY work involving:
- Database queries or table modifications
- API routes that access tenant data
- New migrations
- New tables or columns
- Worker/background job data access

## How RLS Works in Sonalit

### The mechanism

1. Migration `20260521_001_enable_rls.sql` adds `org_id UUID` to every core table
2. Each table gets: `ALTER TABLE <table> ENABLE ROW LEVEL SECURITY`
3. Policy: `CREATE POLICY <table>_org_isolation ON <table> USING (org_id = current_setting('app.current_org_id', true)::UUID)`
4. A non-owner role `sonalit_app` has RLS enforced (table owners bypass RLS)

### The org-scoped query path

File: `backend/src/utils/orgScopedDb.js`

`attachOrgDb(req, res, next)` middleware:
- Reads `req.user.org_id` from the authenticated user
- Creates `req.db(sql, params)` — acquires a pg client, runs `SET LOCAL ROLE sonalit_app` + `SET LOCAL app.current_org_id = <orgId>`, executes the query, releases
- Creates `req.dbTx(fn)` — same but wraps in a transaction for multi-statement operations

### Two query paths

| Path | Function | RLS Applied? | Use When |
|------|----------|-------------|----------|
| `req.db(sql, params)` | Org-scoped | YES | All tenant-owned data queries |
| `query(sql, params)` | Global pool | NO | System-level operations only |

## RULES — Non-Negotiable

### NEVER use `query()` for tenant-owned data

The global `query()` from `config/database.js` bypasses RLS entirely. Using it for tenant data leaks all orgs' data.

```javascript
// WRONG — leaks cross-tenant data
const { query } = require('../config/database');
const result = await query('SELECT * FROM vehicles WHERE id = $1', [id]);

// CORRECT — org-scoped, RLS enforced
const result = await req.db('SELECT * FROM vehicles WHERE id = $1', [id]);
```

### ALWAYS guard for req.db existence

Every route using org-scoped queries must include this guard after `attachOrgDb`:

```javascript
router.use(authenticate, attachOrgDb);
router.use((req, res, next) => {
  if (!req.db) return res.status(403).json({ error: 'org_scope_required' });
  next();
});
```

Evidence: `backend/src/routes/cds.js:9-12`, `backend/src/routes/reports.js:13-16`

### Every new tenant-owned table MUST have

1. `org_id UUID NOT NULL` column
2. `ALTER TABLE <table> ENABLE ROW LEVEL SECURITY`
3. `CREATE POLICY <table>_org_isolation ON <table> USING (org_id = current_setting('app.current_org_id', true)::UUID)`
4. Index on `org_id` (or composite index including it)
5. Foreign key to `organizations(id)` where appropriate

### Materialized views bypass RLS (RULE B)

Materialized views do NOT enforce RLS policies. Any query against a matview MUST include explicit `WHERE org_id = $1` filtering.

Evidence: `driver_scores_30d` and `risk_zone_stats` are matviews that bypass RLS. Routes querying them (`behaviour.js`, `riskzones.js`) use explicit `org_id` filters.

### Workers use `withOrg()` directly (RULE C)

Background workers running outside a request context cannot use `req.db`. They call `withOrg(orgId, async (client) => { ... })` directly from `orgScopedDb.js`.

### NEVER disable RLS to make a test or feature pass

If a query returns no rows when you expect data, the cause is almost certainly a missing or wrong `org_id` — not a broken RLS policy. Fix the data, not the security.

## Relevant Files

- `backend/src/utils/orgScopedDb.js` — `attachOrgDb`, `withOrg`
- `backend/src/config/database.js` — global `query()` (bypass RLS)
- `backend/migrations/20260521_001_enable_rls.sql` — RLS setup for core tables
- `backend/migrations/20260805_073_cds_schema.sql` — RLS on all CDS tables

## Verification

When reviewing any PR that touches database queries:
1. Confirm tenant-owned data uses `req.db`, not `query()`
2. Confirm new tables have `org_id` + RLS + policy
3. Confirm matview queries have explicit `org_id` filters
4. Confirm workers use `withOrg()`
5. Confirm the `org_scope_required` guard is present on routes using `req.db`

## Do

- Use `req.db` for all tenant-owned data
- Add `org_id` + RLS + policy to every new table
- Add explicit `org_id` filters when querying materialized views
- Use `withOrg()` in workers and background jobs
- Test with multiple org_ids to verify isolation

## Don't

- Use `query()` for tenant-owned data — EVER
- Disable RLS for any reason
- Create tables without `org_id` unless they are truly system-level
- Skip the `org_scope_required` guard on org-scoped routes
- Assume RLS will protect matview queries
