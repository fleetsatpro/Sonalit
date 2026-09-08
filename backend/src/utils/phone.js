/** Canonical phone handling for client-facing contact numbers. */
function normalizePhone(value, country = 'Kenya') {
  if (typeof value !== 'string') throw new Error('Phone number is required.');
  const raw = value.trim();
  if (!raw) throw new Error('Phone number is required.');
  if (!/^[+0-9 ()-]+$/.test(raw)) throw new Error('Enter a valid phone number.');

  const compact = raw.replace(/[ ()-]/g, '');
  if (!/^\+?\d+$/.test(compact)) throw new Error('Enter a valid phone number.');

  let digits;
  if (compact.startsWith('+')) {
    digits = compact.slice(1);
  } else if (country === 'Kenya' && /^0\d{9}$/.test(compact)) {
    digits = `254${compact.slice(1)}`;
  } else if (country === 'Kenya' && /^254\d{9}$/.test(compact)) {
    digits = compact;
  } else {
    throw new Error('Enter a valid phone number for the selected country.');
  }

  if (!/^\d{8,15}$/.test(digits)) throw new Error('Enter a valid phone number.');
  if (country === 'Kenya' && !/^2547\d{8}$/.test(digits)) {
    throw new Error('Enter a valid Kenyan mobile number.');
  }
  return `+${digits}`;
}

module.exports = { normalizePhone };
