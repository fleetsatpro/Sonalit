const DIAL_CODES: Record<string, string> = {
  kenya: '254', ke: '254',
  tanzania: '255', tz: '255',
  uganda: '256', ug: '256',
  rwanda: '250', rw: '250',
  burundi: '257', bi: '257',
  ethiopia: '251', et: '251',
  'south africa': '27', za: '27',
  france: '33', fr: '33',
  'united kingdom': '44', uk: '44', gb: '44',
  'united states': '1', usa: '1', us: '1',
};

export function normalizePhone(input: unknown, country = 'Kenya'): string | null {
  const raw = String(input ?? '').trim();
  if (!raw || !/^[+0-9()\s.-]+$/.test(raw)) return null;

  const compact = raw.replace(/[()\s.-]/g, '');
  const hasPlus = compact.startsWith('+');
  let digits = compact.replace(/\D/g, '');
  if (!digits) return null;

  const countryKey = country.trim().toLowerCase();
  const dial = DIAL_CODES[countryKey];

  if (!hasPlus && dial) {
    if (digits.startsWith('0')) digits = dial + digits.slice(1);
    else if (!digits.startsWith(dial)) digits = dial + digits;
  }

  if (countryKey === 'kenya' || countryKey === 'ke') {
    // Kenya national numbers are 9 digits; common local forms begin with 0.
    if (!hasPlus && !dial) return null;
    if (!digits.startsWith('254')) return null;
    const nsn = digits.slice(3);
    if (!/^(?:1\d{8}|2\d{8}|7\d{8}|8\d{8})$/.test(nsn)) return null;
  }

  if (digits.length < 8 || digits.length > 15 || digits.startsWith('0')) return null;
  return `+${digits}`;
}

export function isValidPhone(input: unknown, country = 'Kenya'): boolean {
  return normalizePhone(input, country) !== null;
}
