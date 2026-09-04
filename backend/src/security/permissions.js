/**
 * Canonical permission matrix.
 *
 * A permission is always evaluated inside a resolved scope, so `vehicles.read`
 * means "read vehicles this identity is authorized to see" — never "read every
 * vehicle in Sonalit". Scope comes from the security context; this file only
 * answers what a role may do once scope is established.
 *
 * Roles here are the ones already in the codebase (see ROLE_HIERARCHY in
 * middleware/auth.js and the scoped field roles from migration 077). This maps
 * them onto explicit permissions rather than replacing the role checks that
 * routes already use — both paths stay valid during the transition.
 */

const PERMISSIONS = Object.freeze([
  'fleet.read', 'fleet.write',
  'vehicles.read', 'vehicles.write',
  'drivers.read', 'drivers.write',
  'convoys.read', 'convoys.write',
  'gps.read',
  'alerts.read', 'alerts.manage',
  'reports.read', 'reports.generate', 'reports.export',
  'cds.read', 'cds.manage',
  'containers.read', 'containers.write',
  'bookings.read', 'bookings.write',
  'elocks.read', 'elocks.manage',
  'geofences.read', 'geofences.manage',
  'users.read', 'users.manage',
  'organization.read', 'organization.manage',
]);

const PERMISSION_SET = new Set(PERMISSIONS);

const READ_ONLY = Object.freeze([
  'fleet.read', 'vehicles.read', 'drivers.read', 'convoys.read', 'gps.read',
  'alerts.read', 'reports.read', 'cds.read', 'containers.read', 'bookings.read',
  'elocks.read', 'geofences.read', 'organization.read',
]);

/**
 * Tenant roles. A tenant admin is the top of the *customer* ladder and holds
 * every tenant permission — but no platform permission exists in this matrix at
 * all, so no amount of tenant role escalation reaches the platform domain.
 */
const TENANT_ROLE_PERMISSIONS = Object.freeze({
  admin: PERMISSIONS,

  dispatcher: Object.freeze([
    ...READ_ONLY,
    'fleet.write', 'vehicles.write', 'drivers.write', 'convoys.write',
    'alerts.manage', 'reports.generate', 'cds.manage',
    'containers.write', 'bookings.write', 'elocks.manage', 'geofences.manage',
  ]),

  operator: Object.freeze([
    ...READ_ONLY,
    'convoys.write', 'alerts.manage', 'containers.write', 'bookings.write',
  ]),

  analyst: Object.freeze([...READ_ONLY, 'reports.generate', 'reports.export']),

  cfo: Object.freeze([
    'convoys.read', 'gps.read', 'alerts.read', 'alerts.manage', 'reports.read',
  ]),

  driver: Object.freeze(['convoys.read', 'gps.read']),

  // Scoped field roles reach their own routes by exact role match. They are
  // listed with the narrowest possible set so that permission checks added to
  // shared routes later do not silently widen what they can see.
  yard_agent: Object.freeze(['cds.read', 'containers.read', 'containers.write', 'bookings.read']),
  port_agent: Object.freeze(['cds.read', 'containers.read', 'containers.write', 'bookings.read']),
  response_crew: Object.freeze(['alerts.read', 'convoys.read', 'gps.read']),
  handover_officer: Object.freeze(['convoys.read', 'containers.read']),
});

/**
 * Platform roles. Platform scope is established from the platform_admins table,
 * never from a token claim or a request field.
 */
const PLATFORM_ROLE_PERMISSIONS = Object.freeze({
  PLATFORM_ADMIN: PERMISSIONS,
  PLATFORM_SUPPORT: Object.freeze([...READ_ONLY, 'alerts.manage', 'users.read']),
  PLATFORM_READONLY: READ_ONLY,
});

/** Modules a tenant can be entitled to. */
const MODULES = Object.freeze([
  'FLEET', 'CONVOY', 'GPS', 'ALERTS', 'REPORTING', 'CDS',
  'E_LOCK', 'GEOFENCING', 'ANALYTICS', 'API',
]);

/**
 * Which module a permission belongs to. A permission whose module is not
 * entitled to the tenant is not granted, however the role is configured —
 * entitlement is enforced alongside the permission, not in the UI.
 */
const PERMISSION_MODULE = Object.freeze({
  'fleet.read': 'FLEET', 'fleet.write': 'FLEET',
  'vehicles.read': 'FLEET', 'vehicles.write': 'FLEET',
  'drivers.read': 'FLEET', 'drivers.write': 'FLEET',
  'convoys.read': 'CONVOY', 'convoys.write': 'CONVOY',
  'gps.read': 'GPS',
  'alerts.read': 'ALERTS', 'alerts.manage': 'ALERTS',
  'reports.read': 'REPORTING', 'reports.generate': 'REPORTING', 'reports.export': 'REPORTING',
  'cds.read': 'CDS', 'cds.manage': 'CDS',
  'containers.read': 'CDS', 'containers.write': 'CDS',
  'bookings.read': 'CDS', 'bookings.write': 'CDS',
  'elocks.read': 'E_LOCK', 'elocks.manage': 'E_LOCK',
  'geofences.read': 'GEOFENCING', 'geofences.manage': 'GEOFENCING',
  // users.* and organization.* administer the tenant itself, so they are never
  // gated on a module — a tenant that has bought nothing can still manage its
  // own account.
});

function isValidPermission(permission) {
  return PERMISSION_SET.has(permission);
}

/**
 * Resolve the permissions a role holds, intersected with the tenant's enabled
 * modules. Platform roles are not module-gated: entitlement is a commercial
 * property of a customer account, not a limit on Sonalit's own operators.
 */
function permissionsFor({ scope, role, enabledModules }) {
  const table = scope === 'PLATFORM' ? PLATFORM_ROLE_PERMISSIONS : TENANT_ROLE_PERMISSIONS;
  const granted = table[role] || [];
  if (scope === 'PLATFORM') return [...granted];

  const modules = new Set(enabledModules || []);
  return granted.filter((permission) => {
    const required = PERMISSION_MODULE[permission];
    return !required || modules.has(required);
  });
}

/** Does a resolved permission list satisfy the requirement? */
function hasPermission(permissions, required) {
  return Array.isArray(permissions) && permissions.includes(required);
}

module.exports = {
  PERMISSIONS,
  MODULES,
  PERMISSION_MODULE,
  TENANT_ROLE_PERMISSIONS,
  PLATFORM_ROLE_PERMISSIONS,
  isValidPermission,
  permissionsFor,
  hasPermission,
};
