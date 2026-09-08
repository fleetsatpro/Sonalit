const COUNTRY_DIAL_CODES = {
  Kenya: '254', KE: '254',
  Tanzania: '255', TZ: '255',
  Uganda: '256', UG: '256',
  Rwanda: '250', RW: '250',
  Burundi: '257', BI: '257',
  Ethiopia: '251', ET: '251',
  'South Africa': '27', ZA: '27',
  France: '33', FR: '33',
  'United Kingdom': '44', UK: '44', GB: '44',
  'United States': '1', USA: '1', US: '1',
};

function normalizePhone(input, country = 'Kenya') {
  if (input == null) throw new Error('Phone number is required.');
  const raw = String(input).trim();
  if (!raw) throw new Error('Phone number is required.');
  if (!/^[+0-9()\s-]+$/.test(raw)) throw new Error('Enter a valid phone number.');

  const hasPlus = raw.startsWith('+');
  let digits = raw.replace(/\D/g, '');
  if (!digits) throw new Error('Enter a valid phone number.');

  if (!hasPlus) {
    const dial = COUNTRY_DIAL_CODES[country] || COUNTRY_DIAL_CODES[String(country).trim()];
    if (digits.startsWith('0') && dial) digits = dial + digits.slice(1);
    else if (dial && !digits.startsWith(dial)) digits = dial + digits;
  }

  if (digits.length < 8 || digits.length > 15) throw new Error('Enter a valid phone number.');
  if (digits.startsWith('0')) throw new Error('Enter a valid international or local phone number.');
  return `+${digits}`;
}

function isValidPhone(input, country = 'Kenya') {
  try { normalizePhone(input, country); return true; } catch { return false; }
}

module.exports = { normalizePhone, isValidPhone };
