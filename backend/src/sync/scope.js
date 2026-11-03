/**
 * Replication scope — what a given authenticated principal is allowed to have
 * on a device.
 *
 * Row-level tenant isolation is already handled by RLS (`req.db`), so nothing
 * here re-implements it. What RLS cannot express is "a yard agent has no
 * business holding an offline copy of the convoy roster": inside one org, a
 * scoped field role sees a far narrower slice than a dispatcher, and offline
 * replication would happily hand the whole slice to a shared yard tablet if
 * left to RLS alone.
 *
 * So scope is decided here, server-side, from `req.user.role` only. A client
 * asks for entity types; the server intersects that with this table and
 * silently drops the rest. A device that requests something outside its scope
 * is not an error worth failing the whole sync over — it is usually an app
 * version that knows about an entity type this user cannot see.
 */

/** Every entity type the change feed carries. Must match the migration's triggers. */
const ENTITY_TYPES = Object.freeze([
  'cds_booking',
  'cds_container',
  'cds_trip',
  'convoy',
  'vehicle',
  'cds_incident',
  'cds_geofence',
]);

const OFFICE = ['cds_booking', 'cds_container', 'cds_trip', 'convoy', 'vehicle', 'cds_incident', 'cds_geofence'];

/**
 * Role → replicable entity types.
 *
 * Roles absent from this map replicate nothing. That is deliberate: a role
 * added later must be granted offline access explicitly, rather than inheriting
 * it because someone forgot to think about it.
 */
const ROLE_SCOPE = Object.freeze({
  admin: OFFICE,
  dispatcher: OFFICE,
  operator: OFFICE,
  analyst: ['convoy', 'vehicle', 'cds_incident'],
  cfo: ['convoy', 'vehicle', 'cds_incident', 'cds_geofence'],
  // The yard/port field accounts are scoped to the clamp/unclamp flow in
  // routes/cds.js; their offline copy matches that and nothing more.
  yard_agent: ['cds_booking', 'cds_container', 'cds_trip'],
  port_agent: ['cds_booking', 'cds_container', 'cds_trip'],
  response_crew: ['convoy', 'vehicle', 'cds_incident'],
  handover_officer: ['convoy', 'vehicle'],
});

/** Entity types this principal may replicate. Always a fresh array. */
function scopeFor(user) {
  const allowed = ROLE_SCOPE[user && user.role];
  return allowed ? [...allowed] : [];
}

/**
 * Narrow a client's requested entity types to what it is actually allowed.
 * `requested` empty/absent means "everything I'm allowed".
 */
function resolveEntityTypes(user, requested) {
  const allowed = scopeFor(user);
  if (!Array.isArray(requested) || requested.length === 0) return allowed;
  const set = new Set(allowed);
  return requested.filter(t => set.has(t));
}

module.exports = { ENTITY_TYPES, ROLE_SCOPE, scopeFor, resolveEntityTypes };
