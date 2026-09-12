/**
 * ISO 6346 container number validation.
 *
 * A container number is not an arbitrary string — it is four letters (owner
 * code plus a category identifier), six digits, and a seventh digit that is a
 * checksum over the other ten. That last digit is the whole point: it is what
 * catches the transposed pair or the misread character when someone copies a
 * number off the side of a box in the rain.
 *
 * The manifest never validated it, so a mistyped container number looked
 * exactly like a correct one until the box failed to match at the port. This
 * makes the error visible at the desk instead.
 */

/**
 * Letter values are NOT A=10..Z=35. The standard skips every multiple of 11,
 * because a multiple of 11 would vanish under the mod-11 sum and let a whole
 * class of single-character errors through undetected.
 */
const LETTER_VALUES = {
  A: 10, B: 12, C: 13, D: 14, E: 15, F: 16, G: 17, H: 18, I: 19,
  J: 20, K: 21, L: 23, M: 24, N: 25, O: 26, P: 27, Q: 28, R: 29,
  S: 30, T: 31, U: 32, V: 34, W: 35, X: 36, Y: 37, Z: 38,
};

const FORMAT = /^[A-Z]{4}\d{7}$/;

/** Normalise for comparison: strip spaces/hyphens, upper-case. */
function normalise(raw) {
  return String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * Compute the ISO 6346 check digit for the first 10 characters.
 * Returns null when the input isn't 10 valid characters.
 */
function checkDigit(first10) {
  const s = normalise(first10).slice(0, 10);
  if (!/^[A-Z]{4}\d{6}$/.test(s)) return null;

  let sum = 0;
  for (let i = 0; i < 10; i++) {
    const ch = s[i];
    const value = i < 4 ? LETTER_VALUES[ch] : Number(ch);
    if (value === undefined) return null;
    sum += value * Math.pow(2, i);
  }
  // The published rule is sum mod 11, with a remainder of 10 written as 0.
  // `% 10` expresses exactly that and leaves 0-9 untouched.
  return (sum % 11) % 10;
}

/**
 * Validate a full 11-character container number.
 *
 * Returns { ok, reason } rather than a bare boolean so the manifest can say
 * *why* — "not the right shape" and "shape is right but the check digit is
 * wrong" are different problems with different fixes, and the second is the
 * one that means somebody mistyped a real number.
 */
function validateContainerNumber(raw) {
  const s = normalise(raw);
  if (!s) return { ok: false, reason: 'missing' };
  if (!FORMAT.test(s)) return { ok: false, reason: 'format' };

  const expected = checkDigit(s.slice(0, 10));
  if (expected === null) return { ok: false, reason: 'format' };
  if (expected !== Number(s[10])) {
    return { ok: false, reason: 'check_digit', expected, found: Number(s[10]) };
  }
  return { ok: true };
}

module.exports = { validateContainerNumber, checkDigit, normalise };
