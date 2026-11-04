function resolveSealVerdict({ expectedSeal, observedSeal, sealIntact }) {
  if (sealIntact === false) return false;

  const expected = typeof expectedSeal === 'string' ? expectedSeal.trim() : '';
  const observed = typeof observedSeal === 'string' ? observedSeal.trim() : '';
  if (expected && observed && observed.toUpperCase() !== expected.toUpperCase()) {
    // A mismatched physical identifier is tamper evidence even when the
    // operator did not select the positive/negative radio option.
    return false;
  }
  if (sealIntact === true && expected && observed) return true;

  // Matching or incomplete text alone is not a positive verification. The
  // operator must explicitly confirm the comparison as intact.
  return null;
}

module.exports = { resolveSealVerdict };
