const { resolveSealVerdict } = require('../src/utils/cdsSealVerification');

describe('CDS port seal verification', () => {
  test('records intact only when expected and observed values both exist and match', () => {
    expect(resolveSealVerdict({
      expectedSeal: 'SEAL-00427',
      observedSeal: 'seal-00427',
      sealIntact: true,
    })).toBe(true);
  });

  test('treats an observed mismatch as a tamper result', () => {
    expect(resolveSealVerdict({
      expectedSeal: 'SEAL-00427',
      observedSeal: 'SEAL-00428',
      sealIntact: true,
    })).toBe(false);
  });

  test('records an explicitly broken or missing seal as a tamper result', () => {
    expect(resolveSealVerdict({
      expectedSeal: 'SEAL-00427',
      observedSeal: null,
      sealIntact: false,
    })).toBe(false);
  });

  test.each([
    [{ expectedSeal: null, observedSeal: 'SEAL-00427', sealIntact: true }],
    [{ expectedSeal: 'SEAL-00427', observedSeal: null, sealIntact: true }],
    [{ expectedSeal: null, observedSeal: null, sealIntact: true }],
    [{ expectedSeal: 'SEAL-00427', observedSeal: 'SEAL-00427', sealIntact: undefined }],
  ])('does not claim verification when the evidence is incomplete', input => {
    expect(resolveSealVerdict(input)).toBeNull();
  });

  test('does not treat whitespace-only identifiers as seal evidence', () => {
    expect(resolveSealVerdict({
      expectedSeal: '   ',
      observedSeal: '   ',
      sealIntact: true,
    })).toBeNull();
  });
});
