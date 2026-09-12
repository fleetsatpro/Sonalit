/**
 * QR decoding is pure string work and must never need a network — that is the
 * point of the decode/resolve split. Resolution itself touches IndexedDB and is
 * covered by the field integration tests rather than here.
 */
import { describe, expect, it } from 'vitest';

import { decodeScan } from './qr.js';

describe('decodeScan', () => {
  it('reads a sonalit:// container code', () => {
    const d = decodeScan('sonalit://container/8f14e45f-ceea-467a-9f27-3c1c1c1c1c1c');
    expect(d.kind).toBe('container');
    expect(d.value).toBe('8f14e45f-ceea-467a-9f27-3c1c1c1c1c1c');
  });

  it('reads a hosted /scan/ URL', () => {
    const d = decodeScan('https://app.sonalit.io/scan/booking/abc-123');
    expect(d.kind).toBe('booking');
    expect(d.value).toBe('abc-123');
  });

  it('accepts a bare ISO 6346 container number from a printed plate', () => {
    const d = decodeScan('  msku1234567 ');
    expect(d.kind).toBe('container');
    expect(d.value).toBe('MSKU1234567');
  });

  it('rejects a near-miss container number rather than guessing', () => {
    // Three letters, or the wrong digit count, is not ISO 6346. Guessing would
    // resolve a scan to the wrong container, which is worse than not resolving.
    expect(decodeScan('MSK1234567').kind).toBe('unknown');
    expect(decodeScan('MSKU123456').kind).toBe('unknown');
  });

  it('classifies an unrecognised code as unknown and keeps the raw text', () => {
    const d = decodeScan('https://example.com/whatever');
    expect(d.kind).toBe('unknown');
    expect(d.raw).toBe('https://example.com/whatever');
  });

  it('maps a guardian path to its own kind', () => {
    expect(decodeScan('sonalit://guardian/tok_abc').kind).toBe('guardian_session');
  });
});
