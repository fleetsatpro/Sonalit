---
name: backend-patterns
description: Legacy Express monolith conventions — route structure, controller pattern, middleware stacking, Joi validation, pagination, soft delete, and worker creation.
triggers:
  - Express
  - route
  - controller
  - middleware
  - backend
  - API
  - endpoint
  - worker
  - BullMQ
  - queue
related_skills:
  - multi-tenancy
  - auth-security
  - realtime-events
  - database-migrations
  - testing
---

# Backend Patterns (Legacy Express Monolith)

## Purpose

Teaches the code patterns used in `backend/src/`. The legacy backend is plain JavaScript (CommonJS) — do not convert to TypeScript or ESM. Follow these patterns exactly when adding or modifying routes, controllers, workers, or middleware.

## When to Activate

Any work in `backend/src/`.

## Route Structure

File: `backend/src/routes/<domain>.js`

Standard route template:

```javascript
const router = require('express').Router();
const Joi = require('joi');
const { authenticate, authorize } = require('../middleware/auth');
const { attachOrgDb } = require('../utils/orgScopedDb');
const { asyncHandler } = require('../middleware/error');
const { auditLog } = require('../middleware/audit');
const requireIdempotencyKey = require('../middleware/idempotency');

router.use(authenticate, attachOrgDb);
router.use((req, res, next) => {
  if (!req.db) return res.status(403).json({ error: 'org_scope_required' });
  next();
});

// GET - list
router.get('/', asyncHandler(async (req, res) => {
  const limit = Math.min(200, parseInt(req.query.limit) || 50);
  const offset = parseInt(req.query.offset) || 0;
  const result = await req.db(
    `SELECT * FROM my_table WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  res.json({ data: result.rows });
}));

// POST - create (with idempotency + audit)
router.post('/', requireIdempotencyKey, authorize('admin', 'dispatcher'),
  auditLog('my_table'), asyncHandler(async (req, res) => {
  const { error, value } = schema.validate(req.body);
  if (error) return res.status(400).json({ error: error.message });
  const result = await req.db(
    `INSERT INTO my_table (org_id, ...) VALUES ((current_setting('app.current_org_id',true))::uuid, ...) RETURNING *`,
    [...]
  );
  res.status(201).json({ data: result.rows[0] });
}));

module.exports = router;
```

## Key Patterns

### Middleware Stacking Order

1. `authenticate` — verify JWT, attach `req.user`
2. `attachOrgDb` — create `req.db` with RLS
3. `org_scope_required` guard — fail if no `req.db`
4. Per-route: `authorize('role1', 'role2')` — role check
5. Per-route: `requireIdempotencyKey` — on state-mutating POSTs
6. Per-route: `auditLog('target')` — on important mutations

### Validation

Use Joi for request body validation:

```javascript
const schema = Joi.object({
  name: Joi.string().min(1).max(256).required(),
  status: Joi.string().valid('active', 'inactive').default('active'),
});

const { error, value } = schema.validate(req.body);
if (error) return res.status(400).json({ error: error.message });
```

### Pagination

Standard pattern — cap at 200, default 50:

```javascript
const limit = Math.min(200, parseInt(req.query.limit) || 50);
const offset = parseInt(req.query.offset) || 0;
```

### Soft Delete

All tenant-owned tables use soft delete:

```javascript
// Query: always filter deleted
WHERE deleted_at IS NULL

// Delete: set timestamp, don't remove
UPDATE my_table SET deleted_at = NOW() WHERE id = $1
```

### Response Envelope

All responses use `{ data: ... }` wrapper:

```javascript
res.json({ data: result.rows });          // list
res.json({ data: result.rows[0] });       // single
res.status(201).json({ data: result.rows[0] }); // created
res.json({ ok: true });                   // delete
```

### Error Handling

`asyncHandler` wraps async route handlers — no try/catch needed in routes.

PostgreSQL errors auto-mapped by `middleware/error.js`:
- 23505 (unique violation) → 409
- 23503 (FK violation) → 400
- 23502 (NOT NULL) → 400
- 22P02 (bad input) → 400

### Controller Pattern

For complex domains, extract logic into a controller:

```javascript
// routes/convoys.js
const c = require('../controllers/convoyController');
router.get('/', c.getConvoys);
router.post('/', requireIdempotencyKey, authorize('admin', 'dispatcher'), c.createConvoy);

// controllers/convoyController.js
exports.getConvoys = asyncHandler(async (req, res) => { ... });
exports.createConvoy = asyncHandler(async (req, res) => { ... });
```

Controllers used for: convoys, convoys-CFO, auth, vehicles, messages, alerts, analytics.

### Worker Pattern

BullMQ workers in `backend/src/workers/`:

```javascript
const { Worker } = require('bullmq');
const redis = require('../config/redis');

const worker = new Worker('queueName', async (job) => {
  // process job.data
}, {
  connection: redis,
  concurrency: 5,
});

module.exports = worker;
```

7 queues: `gps`(10), `alert`(5), `notification`(3), `convoyReport`(1), `convoyArchive`(1), `device`(1), `knox`(1).

Default job options: 5 retries, exponential backoff (1s base), keep 1000 completed, never remove failed.

### Centrifugo Publishing

```javascript
const { publish } = require('../realtime/centrifugo');

// Publish to org channel
await publish(`org#${orgId}`, { type: 'my_event', ...data });

// Publish to portal channel
await publish(`portal#${convoyId}`, { type: 'update', ...data });
```

## Route Mount Order (in `app.js`)

Security-critical: routes are mounted in a specific order. The claims router uses unconditional `authenticate` — it must be mounted LAST to avoid swallowing requests.

## Relevant Files

- `backend/src/routes/` — all 52 route files
- `backend/src/controllers/` — 7 controller files
- `backend/src/workers/` — 10 worker files
- `backend/src/middleware/` — auth, csrf, audit, idempotency, error, etc.
- `backend/src/utils/orgScopedDb.js` — org-scoped query
- `backend/src/config/database.js` — pg pool
- `backend/src/config/queue.js` — BullMQ setup
- `backend/src/realtime/centrifugo.js` — publishing

## Do

- Use `asyncHandler` for all async routes
- Use Joi for validation
- Use `req.db` for all tenant queries
- Add `requireIdempotencyKey` on state-mutating POSTs
- Add `auditLog` on important mutations
- Follow the response envelope pattern
- Keep soft delete consistent

## Don't

- Convert to TypeScript or ESM
- Use `query()` for tenant data (see multi-tenancy skill)
- Skip validation on POST/PUT/PATCH endpoints
- Use `req.body` without validation
- Return raw query results without the `{ data: ... }` envelope
- Add try/catch in route handlers (asyncHandler does this)
