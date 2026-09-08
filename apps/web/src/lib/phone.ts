export type PhoneCountry = {
  name: string;
  dialCode: string;
};

const COUNTRY_DIAL_CODES: Record<string, string> = {
  Kenya: '254',
  Tanzania: '255',
  Uganda: '256',
  Rwanda: '250',
};

export function normalizePhone(value: string, country = 'Kenya'): string | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  if (!/^[+0-9\s().-]+$/.test(raw)) return null;

  const hasPlus = raw.startsWith('+');
  let digits = raw.replace(/\D/g, '');
  if (!digits) return null;

  const dialCode = COUNTRY_DIAL_CODES[country] ?? '254';
  if (!hasPlus && digits.startsWith('0')) {
    digits = dialCode + digits.slice(1);
  } else if (!hasPlus && !digits.startsWith(dialCode)) {
    return null;
  }

  if (digits.length < 8 || digits.length > 15) return null;
  return `+${digits}`;
}

export function isValidPhone(value: string, country = 'Kenya'): boolean {
  return normalizePhone(value, country) !== null;
}
