function resolveSealVerdict({ expectedSeal, observedSeal, sealIntact }) {
  if (sealIntact === false) return false;

  const expected = typeof expectedSeal === 'string' ? expectedSeal.trim() : '';
  const observed = typeof observedSeal === 'string' ? observedSeal.trim() : '';
  if (sealIntact === true && expected && observed) {
    return observed.toUpperCase() === expected.toUpperCase();
  }

  // Missing expected or observed identifiers mean "not verified", not intact.
  return null;
}

module.exports = { resolveSealVerdict };
