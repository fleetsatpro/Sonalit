'use strict';

function safeDate(value) {
  if (typeof value !== 'string' && !(value instanceof Date)) return null;
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function manualRetryCooldownMinutes(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return 60;
  return Math.max(5, Math.min(1440, Math.trunc(number)));
}

function assessManualPublicationRetry({ status, deepResearch, now = new Date(), cooldownMinutes = 60 } = {}) {
  const cooldown = manualRetryCooldownMinutes(cooldownMinutes);
  const currentTime = safeDate(now) || new Date();
  const currentStatus = String(status || '').toLowerCase();
  if (!['draft', 'review'].includes(currentStatus)) return {
    allowed: false, statusCode: 409, code: 'publication_not_research_retriable',
    message: 'Only draft or review publications can be re-researched.', cooldownMinutes: cooldown,
  };

  const research = deepResearch && typeof deepResearch === 'object' && !Array.isArray(deepResearch) ? deepResearch : {};
  const timestamps = [];
  const explicitNext = String(research.next_attempt_at || '').trim();
  if (explicitNext) {
    const nextDate = safeDate(explicitNext);
    if (!nextDate) return {
      allowed: false, statusCode: 409, code: 'publication_retry_metadata_invalid',
      message: 'The stored retry timestamp is invalid. Automatic and manual retry remain blocked until an authorized maintainer corrects the publication metadata.',
      cooldownMinutes: cooldown,
    };
    timestamps.push(nextDate);
  }

  const lastAttemptText = String(research.last_attempt_at || '').trim();
  if (lastAttemptText) {
    const lastAttempt = safeDate(lastAttemptText);
    if (!lastAttempt) return {
      allowed: false, statusCode: 409, code: 'publication_retry_metadata_invalid',
      message: 'The stored research-attempt timestamp is invalid. Retry remains blocked until an authorized maintainer corrects the publication metadata.',
      cooldownMinutes: cooldown,
    };
    timestamps.push(new Date(lastAttempt.getTime() + cooldown * 60 * 1000));
  }

  const retryAtMs = timestamps.reduce((latest, date) => Math.max(latest, date.getTime()), 0);
  if (retryAtMs > currentTime.getTime()) return {
    allowed: false, statusCode: 429, code: 'publication_retry_cooldown',
    message: 'A research attempt was recently recorded. Retry is deferred until the cooldown expires.',
    retryAt: new Date(retryAtMs).toISOString(), cooldownMinutes: cooldown,
  };

  // Manual retry after cooldown is allowed even when the automated retry budget is exhausted.
  return { allowed: true, cooldownMinutes: cooldown };
}

module.exports = { assessManualPublicationRetry, manualRetryCooldownMinutes };
