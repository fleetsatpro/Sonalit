/**
 * Tenant-scoped object storage.
 *
 * Sonalit signs R2/S3 URLs from six different places (messageController,
 * convoyHandover, guardianConvoy, guardian-knox, voiceNotes, cds), each
 * building an S3 client inline and composing its own key. The keys carry no
 * tenant at all — `handover-officer/<convoyId>/<truckId>/handover_<uuid>.jpg` —
 * so nothing about an object says which customer owns it, and the only thing
 * standing between a caller and someone else's file is whatever ownership check
 * that particular call site happens to make. Some make a good one (the comms
 * attachment download checks channel membership); a key that reaches a signer
 * without one becomes a signed URL for another tenant's object.
 *
 * This module gives those call sites a single safe path:
 *
 *   buildTenantKey(orgId, ...)  puts every new object under tenants/<orgId>/
 *   assertKeyOwnedBy(orgId, key) refuses a key from outside that prefix
 *   signDownload / signUpload    will not sign without an owning tenant
 *
 * The prefix is NOT the security boundary — a path is just a string, and
 * pre-existing objects have no prefix at all. The boundary is that a signature
 * is only produced after the caller has proven, against the database, that the
 * object belongs to the tenant in the resolved security context. The prefix
 * makes that provable for new objects and makes a mistake visible for old ones.
 */
const crypto = require('crypto');

const TENANT_PREFIX = 'tenants';

// Purposes an object can be signed for. Keeping this closed means a call site
// cannot invent a scope that later reads as something broader.
const PURPOSES = Object.freeze([
  'handover', 'convoy-photo', 'voice-note', 'attachment',
  'knox-recording', 'knox-screenshot', 'cds-document', 'report',
]);

const MAX_DOWNLOAD_TTL = 900;  // 15 min
const MAX_UPLOAD_TTL = 300;    // 5 min

const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * Compose a tenant-scoped object key.
 *
 * @param {string} orgId    owning tenant
 * @param {string} purpose  one of PURPOSES
 * @param {string[]} parts  path segments (ids, names) — sanitised
 * @param {string} ext      file extension without the dot
 */
function buildTenantKey(orgId, purpose, parts, ext) {
  if (!UUID.test(String(orgId || ''))) {
    throw new Error('buildTenantKey: orgId must be a uuid');
  }
  if (!PURPOSES.includes(purpose)) {
    throw new Error(`buildTenantKey: unknown purpose ${purpose}`);
  }

  const safe = (parts || []).map(sanitiseSegment).filter(Boolean);
  const safeExt = String(ext || 'bin').replace(/[^a-zA-Z0-9]/g, '').slice(0, 8) || 'bin';

  // A random component keeps object names unguessable, so knowing the shape of
  // the key is not the same as knowing an object's address.
  const unique = crypto.randomUUID();

  return [TENANT_PREFIX, orgId, purpose, ...safe, `${unique}.${safeExt}`].join('/');
}

/**
 * Strip anything that could climb out of the prefix or confuse a downstream
 * path parser. Traversal is what would let a "tenant-scoped" key address
 * another tenant's object.
 */
function sanitiseSegment(segment) {
  return String(segment == null ? '' : segment)
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .replace(/\.{2,}/g, '-')
    .replace(/^[.-]+/, '')
    .slice(0, 120);
}

/**
 * Read the tenant out of a key, or null when the key predates tenant scoping.
 */
function tenantOfKey(key) {
  const parts = String(key || '').split('/');
  if (parts[0] !== TENANT_PREFIX) return null;
  return UUID.test(parts[1] || '') ? parts[1] : null;
}

/**
 * Refuse a key that is not this tenant's.
 *
 * Legacy keys carry no prefix, so they cannot be attributed from the string
 * alone. Those are allowed through only when the caller passes
 * `legacyOwnershipVerified: true`, which means it has already confirmed
 * ownership against the database — the comms attachment path, for example,
 * loads the row through the tenant-scoped pool before it reaches here.
 * The flag has to be passed deliberately; the default is refusal.
 */
function assertKeyOwnedBy(orgId, key, options = {}) {
  const { legacyOwnershipVerified = false } = options;

  if (!UUID.test(String(orgId || ''))) {
    throw Object.assign(new Error('storage: no owning tenant'), { status: 403 });
  }
  if (typeof key !== 'string' || key.length === 0 || key.length > 1024) {
    throw Object.assign(new Error('storage: invalid key'), { status: 400 });
  }
  if (key.includes('..') || key.startsWith('/')) {
    throw Object.assign(new Error('storage: invalid key'), { status: 400 });
  }

  const owner = tenantOfKey(key);

  if (owner === null) {
    if (legacyOwnershipVerified) return key;
    throw Object.assign(
      new Error('storage: unscoped key requires verified ownership'),
      { status: 403 }
    );
  }

  if (owner.toLowerCase() !== String(orgId).toLowerCase()) {
    throw Object.assign(new Error('storage: key belongs to another tenant'), { status: 403 });
  }

  return key;
}

/**
 * Sign a download URL for an object this tenant owns.
 *
 * @param {Object} params
 * @param {Object} params.client        an S3Client
 * @param {string} params.bucket
 * @param {string} params.key
 * @param {string} params.orgId         owning tenant, from the security context
 * @param {number} [params.expiresIn]   seconds, capped at MAX_DOWNLOAD_TTL
 * @param {boolean} [params.legacyOwnershipVerified]
 */
async function signDownload({ client, bucket, key, orgId, expiresIn = 300, legacyOwnershipVerified = false }) {
  assertKeyOwnedBy(orgId, key, { legacyOwnershipVerified });

  const { GetObjectCommand } = require('@aws-sdk/client-s3');
  const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

  return getSignedUrl(
    client,
    new GetObjectCommand({ Bucket: bucket, Key: key }),
    { expiresIn: clampTtl(expiresIn, MAX_DOWNLOAD_TTL) }
  );
}

/**
 * Sign an upload URL. The key must already be tenant-scoped — an upload has no
 * legacy excuse, so buildTenantKey is the only supported way to produce one.
 */
async function signUpload({ client, bucket, key, orgId, contentType, expiresIn = 300 }) {
  assertKeyOwnedBy(orgId, key);
  if (tenantOfKey(key) === null) {
    throw Object.assign(new Error('storage: uploads must use a tenant-scoped key'), { status: 400 });
  }

  const { PutObjectCommand } = require('@aws-sdk/client-s3');
  const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

  return getSignedUrl(
    client,
    new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType }),
    { expiresIn: clampTtl(expiresIn, MAX_UPLOAD_TTL) }
  );
}

function clampTtl(requested, max) {
  const n = parseInt(requested, 10);
  if (!Number.isFinite(n) || n < 1) return Math.min(300, max);
  return Math.min(n, max);
}

module.exports = {
  TENANT_PREFIX,
  PURPOSES,
  MAX_DOWNLOAD_TTL,
  MAX_UPLOAD_TTL,
  buildTenantKey,
  tenantOfKey,
  assertKeyOwnedBy,
  signDownload,
  signUpload,
  sanitiseSegment,
};
