'use strict';

function safeNonNegativeInteger(value, fallback = 0) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : fallback;
}

function publicationRecoveryMetadata({
  priorResearch = {},
  researchSummary = {},
  expectedResearchCount = 0,
  researchAttempted = false,
  now = new Date(),
  cooldownMinutes = 60,
  maxAttempts = 3,
} = {}) {
  const max = Math.max(1, Math.min(8, safeNonNegativeInteger(maxAttempts, 3) || 3));
  const attempts = safeNonNegativeInteger(priorResearch.recovery_attempts, 0);
  const expected = safeNonNegativeInteger(expectedResearchCount, 0);
  const researched = safeNonNegativeInteger(researchSummary.researched, 0);
  const researchedLimited = safeNonNegativeInteger(researchSummary.researched_limited, 0);
  // Limited research is a recognized dossier state; a zero-incident period does
  // not need incident research, but remains subject to the separate evidence gate.
  const complete = expected === 0 || researched + researchedLimited >= expected;
  const cooldown = Math.max(5, Math.min(1440, safeNonNegativeInteger(cooldownMinutes, 60) || 60));

  return {
    next_attempt_at: complete
      ? null
      : researchAttempted
        ? new Date(now.getTime() + cooldown * 60 * 1000).toISOString()
        : (priorResearch.next_attempt_at || null),
    last_failure_reason: complete
      ? null
      : researchAttempted
        ? 'one or more incident research results fell back to evidence-only content'
        : (priorResearch.last_failure_reason || null),
    recovery_attempts: attempts,
    recovery_max_attempts: max,
    recovery_exhausted: expected > 0 && !complete && attempts >= max,
  };
}

module.exports = { publicationRecoveryMetadata };
