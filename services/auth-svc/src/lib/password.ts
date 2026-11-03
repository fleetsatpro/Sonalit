import { hash, verify } from '@node-rs/argon2';

const ARGON2_OPTIONS = {
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 4,
};

export async function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(storedHash: string, password: string): Promise<boolean> {
  return verify(storedHash, password, ARGON2_OPTIONS);
}

export async function isPasswordPwned(password: string): Promise<boolean> {
  const { createHash } = await import('node:crypto');
  const sha1 = createHash('sha1').update(password).digest('hex').toUpperCase();
  const prefix = sha1.slice(0, 5);
  const suffix = sha1.slice(5);

  try {
    const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: { 'Add-Padding': 'true' },
    });
    if (!res.ok) return false;
    const text = await res.text();
    return text.split('\n').some((line) => {
      const [hash] = line.split(':');
      return hash?.trim() === suffix;
    });
  } catch {
    return false;
  }
}
