import { SignJWT, jwtVerify, generateKeyPair, type JWTPayload, type KeyLike } from 'jose';
import { config } from '../config.js';

interface VaultTransitKey {
  privateKey: KeyLike;
  publicKey: KeyLike;
}

interface VaultSignResponse {
  data: {
    signature: string;
  };
}

interface VaultKeyResponse {
  data: {
    keys: Record<string, { public_key: string }>;
  };
}

// Dev-only in-memory key pair (when Vault is not configured)
let devKeyPair: VaultTransitKey | null = null;

async function getDevKeyPair(): Promise<VaultTransitKey> {
  if (!devKeyPair) {
    const { privateKey, publicKey } = await generateKeyPair('RS256');
    devKeyPair = { privateKey, publicKey };
  }
  return devKeyPair;
}

async function getVaultPublicKey(): Promise<string> {
  const res = await fetch(
    `${config.VAULT_ADDR}/v1/transit/keys/${config.VAULT_TRANSIT_KEY}`,
    { headers: { 'X-Vault-Token': config.VAULT_TOKEN ?? '' } },
  );
  if (!res.ok) throw new Error(`Vault key fetch failed: ${res.status}`);
  const body = await res.json() as VaultKeyResponse;
  const keys = body.data.keys;
  const latest = Object.keys(keys).sort((a, b) => Number(b) - Number(a))[0];
  if (!latest) throw new Error('No Vault transit keys found');
  const keyEntry = keys[latest];
  if (!keyEntry) throw new Error('Vault transit key entry missing');
  return keyEntry.public_key;
}

async function vaultSign(signingInput: string): Promise<string> {
  const { createHash } = await import('node:crypto');
  // SHA-256 hash of the ASCII bytes of "header.payload" — Vault signs the pre-hashed digest.
  const hash = createHash('sha256').update(signingInput, 'ascii').digest('base64');
  const res = await fetch(
    `${config.VAULT_ADDR}/v1/transit/sign/${config.VAULT_TRANSIT_KEY}`,
    {
      method: 'POST',
      headers: {
        'X-Vault-Token': config.VAULT_TOKEN ?? '',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ input: hash, hash_algorithm: 'sha2-256', prehashed: true }),
      signal: AbortSignal.timeout(5_000),
    },
  );
  if (!res.ok) throw new Error(`Vault sign failed: ${res.status}`);
  const body = await res.json() as VaultSignResponse;
  // Vault signature format: vault:v1:<standard-base64>
  // JWT signature must be base64url (no padding, - instead of +, _ instead of /).
  const parts = body.data.signature.split(':');
  const sigB64Standard = parts[2];
  if (!sigB64Standard) throw new Error('Invalid Vault signature format');
  return Buffer.from(sigB64Standard, 'base64').toString('base64url');
}

function isVaultConfigured(): boolean {
  return Boolean(config.VAULT_ADDR && config.VAULT_TOKEN);
}

export async function signAccessToken(extraClaims: Record<string, unknown>): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + config.JWT_ACCESS_TTL_S;

  if (isVaultConfigured()) {
    // Build unsigned JWT header+payload, then get Vault to sign it
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
    const claims = {
      iss: config.JWT_ISSUER,
      aud: config.JWT_AUDIENCE,
      iat: now,
      exp,
      type: 'access',
      ...extraClaims,
    };
    const payloadB64 = Buffer.from(JSON.stringify(claims)).toString('base64url');
    const unsigned = `${header}.${payloadB64}`;
    const sig = await vaultSign(unsigned);
    return `${unsigned}.${sig}`;
  }

  const keys = await getDevKeyPair();
  return new SignJWT({ type: 'access', ...extraClaims })
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuer(config.JWT_ISSUER)
    .setAudience(config.JWT_AUDIENCE)
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .sign(keys.privateKey);
}

export async function signRefreshToken(
  familyId: string,
  userId: string,
  orgId: string,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + config.JWT_REFRESH_TTL_S;

  if (isVaultConfigured()) {
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
    const claims = {
      iss: config.JWT_ISSUER,
      aud: config.JWT_AUDIENCE,
      sub: userId,
      org_id: orgId,
      fid: familyId,
      iat: now,
      exp,
      type: 'refresh',
    };
    const payloadB64 = Buffer.from(JSON.stringify(claims)).toString('base64url');
    const unsigned = `${header}.${payloadB64}`;
    const sig = await vaultSign(unsigned);
    return `${unsigned}.${sig}`;
  }

  const keys = await getDevKeyPair();
  return new SignJWT({ sub: userId, org_id: orgId, fid: familyId, type: 'refresh' })
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuer(config.JWT_ISSUER)
    .setAudience(config.JWT_AUDIENCE)
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .sign(keys.privateKey);
}

export async function verifyToken(token: string): Promise<JWTPayload> {
  if (isVaultConfigured()) {
    const pubKeyPem = await getVaultPublicKey();
    const { importSPKI } = await import('jose');
    const publicKey = await importSPKI(pubKeyPem, 'RS256');
    const { payload } = await jwtVerify(token, publicKey, {
      issuer: config.JWT_ISSUER,
      audience: config.JWT_AUDIENCE,
    });
    return payload;
  }

  const keys = await getDevKeyPair();
  const { payload } = await jwtVerify(token, keys.publicKey, {
    issuer: config.JWT_ISSUER,
    audience: config.JWT_AUDIENCE,
  });
  return payload;
}
