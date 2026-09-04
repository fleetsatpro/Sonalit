/**
 * Permission matrix and module entitlement — unit tests, no database.
 *
 * These pin the properties the rest of the authorization layer relies on:
 * a tenant role can never reach the platform domain, and a permission belonging
 * to a module the tenant has not bought is not granted however the role is
 * configured.
 */
const {
  PERMISSIONS,
  PERMISSION_MODULE,
  TENANT_ROLE_PERMISSIONS,
  PLATFORM_ROLE_PERMISSIONS,
  permissionsFor,
  hasPermission,
  isValidPermission,
} = require('../src/security/permissions');

const ALL_MODULES = ['FLEET', 'CONVOY', 'GPS', 'ALERTS', 'REPORTING', 'CDS',
  'E_LOCK', 'GEOFENCING', 'ANALYTICS', 'API'];

describe('permission matrix integrity', () => {
  test('every role grants only permissions that exist in the canonical list', () => {
    const tables = { ...TENANT_ROLE_PERMISSIONS, ...PLATFORM_ROLE_PERMISSIONS };
    for (const [role, granted] of Object.entries(tables)) {
      for (const permission of granted) {
        expect({ role, permission, valid: isValidPermission(permission) })
          .toEqual({ role, permission, valid: true });
      }
    }
  });

  test('every module referenced by a permission is a real module', () => {
    for (const moduleName of Object.values(PERMISSION_MODULE)) {
      expect(ALL_MODULES).toContain(moduleName);
    }
  });

  test('tenant admin holds every tenant permission', () => {
    const granted = permissionsFor({ scope: 'TENANT', role: 'admin', enabledModules: ALL_MODULES });
    expect(granted.sort()).toEqual([...PERMISSIONS].sort());
  });
});

describe('module entitlement gates permissions', () => {
  test('a tenant without CDS gets no CDS permission, even as admin', () => {
    const granted = permissionsFor({
      scope: 'TENANT',
      role: 'admin',
      enabledModules: ['FLEET', 'CONVOY', 'GPS'],
    });

    expect(hasPermission(granted, 'cds.read')).toBe(false);
    expect(hasPermission(granted, 'cds.manage')).toBe(false);
    expect(hasPermission(granted, 'containers.write')).toBe(false);
    expect(hasPermission(granted, 'bookings.read')).toBe(false);
    // ...but the modules it does hold still work.
    expect(hasPermission(granted, 'vehicles.read')).toBe(true);
    expect(hasPermission(granted, 'convoys.write')).toBe(true);
  });

  test('a tenant with no modules at all can still administer its own account', () => {
    const granted = permissionsFor({ scope: 'TENANT', role: 'admin', enabledModules: [] });

    // users.* and organization.* are never module-gated: an account with no
    // entitlements must still be able to manage itself.
    expect(hasPermission(granted, 'users.manage')).toBe(true);
    expect(hasPermission(granted, 'organization.manage')).toBe(true);
    expect(hasPermission(granted, 'vehicles.read')).toBe(false);
  });

  test('removing a module immediately removes its permissions', () => {
    const before = permissionsFor({ scope: 'TENANT', role: 'dispatcher', enabledModules: ALL_MODULES });
    const after = permissionsFor({
      scope: 'TENANT',
      role: 'dispatcher',
      enabledModules: ALL_MODULES.filter((m) => m !== 'GPS'),
    });

    expect(hasPermission(before, 'gps.read')).toBe(true);
    expect(hasPermission(after, 'gps.read')).toBe(false);
  });
});

describe('tenant roles cannot reach the platform domain', () => {
  test('no tenant role grants a platform-only capability', () => {
    // The matrix contains no platform permission at all, so escalation via role
    // is structurally impossible rather than merely filtered.
    for (const role of Object.keys(TENANT_ROLE_PERMISSIONS)) {
      const granted = permissionsFor({ scope: 'TENANT', role, enabledModules: ALL_MODULES });
      expect(granted.some((p) => /^platform\./.test(p))).toBe(false);
    }
  });

  test('an unknown role gets nothing', () => {
    expect(permissionsFor({ scope: 'TENANT', role: 'wizard', enabledModules: ALL_MODULES })).toEqual([]);
    expect(permissionsFor({ scope: 'TENANT', role: undefined, enabledModules: ALL_MODULES })).toEqual([]);
  });

  test('a tenant role name is not honoured in platform scope', () => {
    // Asking for platform scope with a tenant role resolves to no permissions —
    // the two tables are separate namespaces.
    expect(permissionsFor({ scope: 'PLATFORM', role: 'admin' })).toEqual([]);
  });
});

describe('scoped field roles stay narrow', () => {
  test('field roles cannot read fleet or generate reports', () => {
    for (const role of ['yard_agent', 'port_agent', 'response_crew', 'handover_officer']) {
      const granted = permissionsFor({ scope: 'TENANT', role, enabledModules: ALL_MODULES });
      expect(hasPermission(granted, 'reports.export')).toBe(false);
      expect(hasPermission(granted, 'users.manage')).toBe(false);
      expect(hasPermission(granted, 'organization.manage')).toBe(false);
    }
  });

  test('cfo holds convoy visibility but no write access to fleet', () => {
    const granted = permissionsFor({ scope: 'TENANT', role: 'cfo', enabledModules: ALL_MODULES });
    expect(hasPermission(granted, 'convoys.read')).toBe(true);
    expect(hasPermission(granted, 'vehicles.write')).toBe(false);
    expect(hasPermission(granted, 'users.manage')).toBe(false);
  });
});

describe('platform roles', () => {
  test('PLATFORM_READONLY holds no write permission', () => {
    const granted = permissionsFor({ scope: 'PLATFORM', role: 'PLATFORM_READONLY' });
    expect(granted.some((p) => /\.(write|manage|generate|export)$/.test(p))).toBe(false);
  });

  test('platform permissions are not module-gated', () => {
    // enabledModules is irrelevant in platform scope — entitlement is a
    // commercial property of a customer account, not a limit on Sonalit.
    const withNone = permissionsFor({ scope: 'PLATFORM', role: 'PLATFORM_ADMIN', enabledModules: [] });
    const withAll = permissionsFor({ scope: 'PLATFORM', role: 'PLATFORM_ADMIN', enabledModules: ALL_MODULES });
    expect(withNone).toEqual(withAll);
  });
});
