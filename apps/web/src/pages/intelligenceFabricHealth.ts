export type IntelQueryHealth = {
  label: string;
  isError: boolean;
  isPending: boolean;
  data?: unknown;
};
export type CollectionSourceHealth = {
  active?: boolean | null;
  health?: {
    status?: string | null;
    error_count?: number | string | null;
    started_at?: string | null;
    finished_at?: string | null;
    error_message?: string | null;
  } | null;
  metrics?: { latest_observation?: string | null } | null;
};
export type IntelFabricHealth = {
  label: 'REQUEST FAILED' | 'DEGRADED' | 'CHECKING' | 'UNCONFIGURED' | 'STALE' | 'PARTIAL' | 'UNKNOWN' | 'RESPONDING';
  tone: 'danger' | 'warning' | 'neutral' | 'healthy';
  detail: string;
  failedQueries: string[];
  staleQueries: string[];
  registeredSources: number;
  activeSources: number;
  inactiveSources: number;
  healthySources: number;
  failedSources: number;
  staleSources: number;
  unknownSources: number;
  inProgressSources: number;
  lastSuccessAt: string | null;
};
const FRESH_FOR_MS = 24 * 60 * 60 * 1000;
const SUCCESS_STATES = new Set(['success', 'succeeded', 'complete', 'completed', 'ok']);
const FAILURE_STATES = new Set(['failed', 'failure', 'error', 'unavailable', 'partial', 'degraded']);
const RUNNING_STATES = new Set(['running', 'queued', 'pending', 'started', 'in_progress', 'in-progress']);
function parsedTime(value: unknown): number | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}
export function assessIntelFabricHealth(queries: IntelQueryHealth[], sources: CollectionSourceHealth[], nowMs = Date.now()): IntelFabricHealth {
  const failedQueries = queries.filter(q => q.isError && q.data === undefined).map(q => q.label);
  const staleQueries = queries.filter(q => q.isError && q.data !== undefined).map(q => q.label);
  const pendingQueries = queries.filter(q => q.isPending && q.data === undefined);
  let healthySources = 0, failedSources = 0, staleSources = 0, unknownSources = 0, inProgressSources = 0;
  const activeSources = sources.filter(source => source.active !== false);
  const inactiveSources = sources.length - activeSources.length;
  let latestSuccessMs: number | null = null;
  for (const source of activeSources) {
    const run = source.health;
    if (!run) { unknownSources++; continue; }
    const state = String(run.status || '').trim().toLowerCase();
    const errorCount = Number(run.error_count || 0);
    const finishedAt = parsedTime(run.finished_at || run.started_at);
    if (RUNNING_STATES.has(state)) { inProgressSources++; continue; }
    if (FAILURE_STATES.has(state) || errorCount > 0) { failedSources++; continue; }
    if (!SUCCESS_STATES.has(state) || finishedAt === null) { unknownSources++; continue; }
    latestSuccessMs = latestSuccessMs === null ? finishedAt : Math.max(latestSuccessMs, finishedAt);
    const ageMs = nowMs - finishedAt;
    if (ageMs < -5 * 60 * 1000) unknownSources++;
    else if (ageMs > FRESH_FOR_MS) staleSources++;
    else healthySources++;
  }
  const base = {
    failedQueries, staleQueries, registeredSources: sources.length, activeSources: activeSources.length,
    inactiveSources, healthySources, failedSources, staleSources, unknownSources, inProgressSources,
    lastSuccessAt: latestSuccessMs === null ? null : new Date(latestSuccessMs).toISOString(),
  };
  if (failedQueries.length) return {
    ...base, label: 'REQUEST FAILED', tone: 'danger',
    detail: 'Unable to load: ' + failedQueries.join(', ') + '. The affected views are unknown; empty results must not be treated as an incident-free situation.',
  };
  if (staleQueries.length) return {
    ...base, label: 'DEGRADED', tone: 'warning',
    detail: 'Refresh failed for ' + staleQueries.join(', ') + ' while cached data remains visible. Verify freshness before relying on those results.',
  };
  if (pendingQueries.length || inProgressSources > 0) return {
    ...base, label: 'CHECKING', tone: 'neutral',
    detail: 'Checking ' + pendingQueries.length + ' intelligence request(s); ' + inProgressSources + ' collection run(s) are still in progress. No live status is asserted during a check.',
  };
  if (sources.length === 0 || activeSources.length === 0) return {
    ...base, label: 'UNCONFIGURED', tone: 'neutral',
    detail: sources.length === 0
      ? 'No collection sources were returned for this tenant. This does not establish that the security situation is quiet.'
      : 'All returned sources are inactive. No active collection health can be established.',
  };
  if (failedSources > 0) return {
    ...base, label: 'DEGRADED', tone: 'warning',
    detail: healthySources + ' source(s) have recent successful runs; ' + failedSources + ' latest run(s) failed or reported errors, ' + staleSources + ' are stale, and ' + unknownSources + ' have no verified run state.',
  };
  if (healthySources === 0 && staleSources > 0) return {
    ...base, label: 'STALE', tone: 'warning',
    detail: 'No active source has a successful collection run in the last 24 hours. ' + staleSources + ' source(s) are stale; ' + unknownSources + ' have unknown health.',
  };
  if (healthySources > 0 && (staleSources > 0 || unknownSources > 0)) return {
    ...base, label: 'PARTIAL', tone: 'warning',
    detail: healthySources + ' source(s) have recent successful runs, ' + staleSources + ' are stale, and ' + unknownSources + ' have no verified run state. Coverage is incomplete.',
  };
  if (healthySources > 0) return {
    ...base, label: 'RESPONDING', tone: 'healthy',
    detail: healthySources + ' active source(s) have recent successful collection runs with no recorded provider errors. This indicates collection health, not proof that no incidents occurred.',
  };
  return {
    ...base, label: 'UNKNOWN', tone: 'neutral',
    detail: 'No recent successful source run can be verified. ' + unknownSources + ' active source(s) have missing or unrecognised health metadata.',
  };
}
