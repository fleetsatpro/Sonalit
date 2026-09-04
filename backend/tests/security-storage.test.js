/**
 * Tenant-scoped object storage — unit tests, no network or database.
 *
 * These pin the properties the signing paths depend on: a key can be attributed
 * to a tenant, a key from another tenant is refused, an unscoped legacy key is
 * refused unless ownership was proven elsewhere, and nothing in a caller-supplied
 * segment can climb out of the tenant prefix.
 */
const {
  buildTenantKey,
  tenantOfKey,
  assertKeyOwnedBy,
  sanitiseSegment,
  MAX_UPLOAD_TTL,
  MAX_DOWNLOAD_TTL,
} = require('../src/security/storage');

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';

describe('tenant-scoped keys', () => {
  test('a built key is attributable to its tenant', () => {
    const key = buildTenantKey(ORG_A, 'handover', ['convoy-1', 'truck-2'], 'jpg');
    expect(key.startsWith(`tenants/${ORG_A}/handover/`)).toBe(true);
    expect(tenantOfKey(key)).toBe(ORG_A);
    expect(key.endsWith('.jpg')).toBe(true);
  });

  test('two keys for the same inputs never collide', () => {
    const a = buildTenantKey(ORG_A, 'handover', ['c', 't'], 'jpg');
    const b = buildTenantKey(ORG_A, 'handover', ['c', 't'], 'jpg');
    // Object names must be unguessable — knowing the shape of a key must not be
    // the same as knowing an object's address.
    expect(a).not.toBe(b);
  });

  test('an unknown purpose is refused', () => {
    expect(() => buildTenantKey(ORG_A, 'exfiltrate', [], 'jpg')).toThrow(/unknown purpose/);
  });

  test('a non-uuid tenant is refused', () => {
    expect(() => buildTenantKey('not-a-uuid', 'handover', [], 'jpg')).toThrow(/must be a uuid/);
  });
});

describe('path traversal cannot escape the tenant prefix', () => {
  test('traversal segments are neutralised', () => {
    const key = buildTenantKey(ORG_A, 'handover', ['../../..', `../${ORG_B}`], 'jpg');
    expect(key.includes('..')).toBe(false);
    expect(tenantOfKey(key)).toBe(ORG_A);
  });

  test('sanitiseSegment strips separators and leading dots', () => {
    expect(sanitiseSegment('../etc/passwd')).not.toContain('/');
    expect(sanitiseSegment('../etc/passwd')).not.toContain('..');
    expect(sanitiseSegment('.hidden')).not.toMatch(/^\./);
  });

  test('an extension cannot smuggle a path', () => {
    const key = buildTenantKey(ORG_A, 'handover', ['x'], '../../evil');
    expect(key.includes('..')).toBe(false);
  });
});

describe('key ownership assertions', () => {
  test("a tenant's own key passes", () => {
    const key = buildTenantKey(ORG_A, 'voice-note', ['n'], 'm4a');
    expect(assertKeyOwnedBy(ORG_A, key)).toBe(key);
  });

  test("another tenant's key is refused", () => {
    const key = buildTenantKey(ORG_B, 'voice-note', ['n'], 'm4a');
    expect(() => assertKeyOwnedBy(ORG_A, key)).toThrow(/another tenant/);
  });

  test('an unscoped legacy key is refused by default', () => {
    // This is the shape of every key written before tenant scoping existed.
    const legacy = 'handover-officer/convoy-1/truck-2/handover_abc.jpg';
    expect(() => assertKeyOwnedBy(ORG_A, legacy)).toThrow(/verified ownership/);
  });

  test('an unscoped legacy key passes only when ownership was proven elsewhere', () => {
    const legacy = 'handover-officer/convoy-1/truck-2/handover_abc.jpg';
    expect(assertKeyOwnedBy(ORG_A, legacy, { legacyOwnershipVerified: true })).toBe(legacy);
  });

  test('traversal and absolute keys are refused outright', () => {
    expect(() => assertKeyOwnedBy(ORG_A, `tenants/${ORG_A}/../${ORG_B}/x.jpg`)).toThrow(/invalid key/);
    expect(() => assertKeyOwnedBy(ORG_A, '/etc/passwd')).toThrow(/invalid key/);
  });

  test('a missing tenant is refused before anything else', () => {
    const key = buildTenantKey(ORG_A, 'report', [], 'pdf');
    expect(() => assertKeyOwnedBy(null, key)).toThrow(/no owning tenant/);
    expect(() => assertKeyOwnedBy(undefined, key)).toThrow(/no owning tenant/);
  });

  test('a key claiming the prefix with a bogus tenant is not attributable', () => {
    // "tenants/<not-a-uuid>/..." must not read as scoped, so it falls into the
    // legacy branch and is refused rather than trusted.
    const spoofed = 'tenants/anything/handover/x.jpg';
    expect(tenantOfKey(spoofed)).toBeNull();
    expect(() => assertKeyOwnedBy(ORG_A, spoofed)).toThrow(/verified ownership/);
  });
});

describe('signed URL lifetimes are bounded', () => {
  test('the caps are short', () => {
    expect(MAX_UPLOAD_TTL).toBeLessThanOrEqual(300);
    expect(MAX_DOWNLOAD_TTL).toBeLessThanOrEqual(900);
  });
});
