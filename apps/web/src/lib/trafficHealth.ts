export type TrafficHealthStatus = string | null | undefined;

/**
 * Return an operator-facing message when traffic evidence is incomplete.
 * Empty or stale incident feeds are never equivalent to verified clear roads.
 */
export function trafficAvailabilityNotice(
  requestFailed: boolean,
  healthStatus?: TrafficHealthStatus,
): string | null {
  if (requestFailed) {
    return 'Traffic incident data is unavailable. Road conditions are unknown, not confirmed clear.';
  }

  switch (String(healthStatus ?? '').trim().toUpperCase()) {
    case 'STALE':
      return 'Traffic observations are stale. Road conditions may have changed since the last successful fetch.';
    case 'PARTIAL':
    case 'UNKNOWN':
      return 'Traffic coverage is partial or unknown. No reported incidents do not confirm clear roads.';
    case 'UNAVAILABLE':
    case 'AUTH_REQUIRED':
    case 'RATE_LIMITED':
    case 'DEGRADED':
      return 'The traffic source is degraded. Road conditions are unknown, not confirmed clear.';
    default:
      return null;
  }
}
