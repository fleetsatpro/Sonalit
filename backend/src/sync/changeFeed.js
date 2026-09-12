/**
 * Incremental pull.
 *
 * The contract is one integer: `checkpoint`. A device says "I have everything
 * up to seq N"; the server returns the changes with seq > N, in seq order, up
 * to a page limit, plus the new checkpoint. Resuming is therefore free — an
 * interrupted pull just re-asks from wherever it actually got to, and a device
 * that has been dark for a week walks the same path in pages.
 *
 * Why a sequence and not `updated_at`: two rows committed in the same
 * millisecond, a replica whose clock drifts, or a long transaction that commits
 * out of order all produce a timestamp cursor that silently skips records. The
 * failure mode is invisible — the device just never learns about a container —
 * which is exactly the kind of bug a field app cannot afford. `seq` comes from
 * a single sequence, and the pull is a strict `>` on it.
 *
 * Rows are materialised at pull time rather than stored in the change log. The
 * log holds identity only (what changed, when, at which revision); the current
 * body is read through `req.db`, so RLS decides visibility on every single pull
 * and a permission that was revoked while the device was offline takes effect
 * immediately instead of being served from a stale snapshot.
 */

const { resolveEntityTypes } = require('./scope');

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1000;

/**
 * How to materialise each entity type.
 *
 * `columns` is an explicit allowlist, never `SELECT *`: a column added to
 * cds_bookings tomorrow should not silently start replicating to every yard
 * tablet. `table` is interpolated into SQL, so it may only ever come from this
 * map — never from request input.
 *
 * `dynamic` types resolve their column list from information_schema instead.
 * Those tables have drifted across migrations and a hard-coded list would make
 * a pull fail outright on a deployment that is one migration behind; the
 * allowlist there is "every non-binary column except org_id".
 */
const ENTITY_SOURCES = Object.freeze({
  cds_booking: {
    table: 'cds_bookings',
    columns: `id, booking_number, customer_id, commodity, weight_kg, seal_number,
              container_type, container_size, pickup_location, delivery_location,
              shipping_line, vessel, voyage, eta, reference, status, revision,
              created_at, updated_at`,
  },
  cds_container: {
    table: 'cds_containers',
    columns: `id, number, iso_type, container_type, container_size, status,
              lat, lng, current_location, condition, revision,
              created_at, updated_at`,
  },
  cds_trip: {
    table: 'cds_trips',
    columns: `id, status, revision, created_at, updated_at`,
    dynamic: true,
  },
  convoy: {
    table: 'convoys',
    columns: `id, name, region, status, priority, description, departure_time,
              arrival_time, estimated_arrival, route_origin, route_destination,
              revision, created_at, updated_at`,
  },
  vehicle: {
    table: 'vehicles',
    columns: `id, type, registration, region, status, capacity, latitude, longitude,
              heading, last_ping, assigned_convoy_id, created_at, updated_at`,
  },
  cds_incident: {
    table: 'cds_incidents',
    columns: `id, created_at, updated_at`,
    dynamic: true,
  },
  cds_geofence: {
    table: 'cds_geofences',
    columns: `id, created_at, updated_at`,
    dynamic: true,
  },
});

const dynamicColumnCache = new Map();

async function columnsFor(db, entityType) {
  const src = ENTITY_SOURCES[entityType];
  if (!src.dynamic) return src.columns;
  if (dynamicColumnCache.has(entityType)) return dynamicColumnCache.get(entityType);

  const res = await db(
    `SELECT column_name FROM information_schema.columns
      WHERE table_name = $1
        AND data_type <> 'bytea'
        AND column_name <> 'org_id'`,
    [src.table]
  );
  const cols = res.rows.length
    ? res.rows.map(r => `"${r.column_name}"`).join(', ')
    : src.columns;
  dynamicColumnCache.set(entityType, cols);
  return cols;
}

/** Reset the introspection cache. Test seam only. */
function _resetColumnCache() {
  dynamicColumnCache.clear();
}

/**
 * Read one page of changes.
 *
 * @param {Function} db   req.db — org-scoped, RLS-enforcing
 * @param {object}   user authenticated principal (role decides scope)
 * @param {object}   opts { checkpoint, entityTypes, limit }
 */
async function pull(db, user, opts = {}) {
  const entityTypes = resolveEntityTypes(user, opts.entityTypes);
  const checkpoint = Number.isFinite(opts.checkpoint) && opts.checkpoint > 0
    ? Math.floor(opts.checkpoint)
    : 0;
  const limit = Math.min(
    Math.max(Number.isFinite(opts.limit) ? Math.floor(opts.limit) : DEFAULT_LIMIT, 1),
    MAX_LIMIT
  );

  const head = await db('SELECT COALESCE(MAX(seq), 0)::bigint AS head FROM sync_change_log');
  const headSeq = Number(head.rows[0].head);
  const serverTime = new Date().toISOString();

  if (entityTypes.length === 0) {
    return { changes: [], checkpoint: headSeq, hasMore: false, serverTime };
  }

  // One extra row tells us whether another page exists without a second COUNT.
  const log = await db(
    `SELECT seq, entity_type, entity_id, operation, revision, changed_at
       FROM sync_change_log
      WHERE seq > $1
        AND entity_type = ANY($2::text[])
      ORDER BY seq ASC
      LIMIT $3`,
    [checkpoint, entityTypes, limit + 1]
  );

  const hasMore = log.rows.length > limit;
  const rows = hasMore ? log.rows.slice(0, limit) : log.rows;

  if (rows.length === 0) {
    return { changes: [], checkpoint: headSeq, hasMore: false, serverTime };
  }

  // Collapse: a container updated forty times since the last pull is one row on
  // the wire, at its latest revision. This is the biggest single bandwidth win
  // in the pull path, and it is safe because the body is materialised fresh
  // anyway — an intermediate revision has no reader.
  const latest = new Map();
  for (const r of rows) latest.set(`${r.entity_type} ${r.entity_id}`, r);

  const byType = new Map();
  for (const r of latest.values()) {
    if (!byType.has(r.entity_type)) byType.set(r.entity_type, []);
    byType.get(r.entity_type).push(r);
  }

  const changes = [];
  for (const [entityType, entries] of byType) {
    const src = ENTITY_SOURCES[entityType];
    if (!src) continue;

    for (const d of entries.filter(e => e.operation === 'delete')) {
      changes.push({
        seq: Number(d.seq),
        entity_type: entityType,
        entity_id: d.entity_id,
        operation: 'delete',
        revision: d.revision == null ? null : Number(d.revision),
        server_updated_at: d.changed_at,
        data: null,
      });
    }

    const upserts = entries.filter(e => e.operation !== 'delete');
    if (upserts.length === 0) continue;

    const cols = await columnsFor(db, entityType);
    const ids = upserts.map(e => e.entity_id);

    // RLS applies here, so a row the caller may no longer see simply does not
    // come back — and is reported to the device as a delete below, which is the
    // correct offline behaviour for "you lost access to this".
    let body;
    try {
      body = await db(
        `SELECT ${cols} FROM ${src.table} WHERE id::text = ANY($1::text[])`,
        [ids]
      );
    } catch (err) {
      // A missing table/column on this deployment must not fail the whole pull;
      // the entity type is simply not replicated here.
      if (err.code === '42P01' || err.code === '42703') continue;
      throw err;
    }

    const bodyById = new Map(body.rows.map(r => [String(r.id), r]));

    for (const e of upserts) {
      const data = bodyById.get(e.entity_id) || null;
      changes.push({
        seq: Number(e.seq),
        entity_type: entityType,
        entity_id: e.entity_id,
        // No body means invisible-to-this-caller (hard delete, or a scope
        // change). Either way the device must drop its copy.
        operation: data ? 'upsert' : 'delete',
        revision: data && data.revision != null ? Number(data.revision) : null,
        server_updated_at: (data && data.updated_at) || e.changed_at,
        data,
      });
    }
  }

  changes.sort((a, b) => a.seq - b.seq);

  // The new checkpoint is the last seq actually walked, not the collapsed
  // maximum — advancing past a row we did not consider would lose it forever.
  const newCheckpoint = Number(rows[rows.length - 1].seq);

  return { changes, checkpoint: newCheckpoint, hasMore, serverTime };
}

module.exports = { pull, ENTITY_SOURCES, DEFAULT_LIMIT, MAX_LIMIT, _resetColumnCache };
