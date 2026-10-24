import { useQuery } from '@tanstack/react-query';
import { Activity, CircleHelp, Clock3, RefreshCw, ShieldAlert, ShieldCheck } from 'lucide-react';
import {
  checkStateLabel,
  fetchSystemHealth,
  formatAge,
  formatUptime,
  getOverallHealthState,
  isFreshHealthCheck,
  isFreshHealthSnapshot,
  type HealthCheckState,
} from '../lib/systemHealth.js';

const STATE_STYLES: Record<HealthCheckState, { text: string; border: string; mark: string }> = {
  healthy: { text: 'text-emerald-300', border: 'border-emerald-400/20', mark: 'bg-emerald-300' },
  degraded: { text: 'text-amber-200', border: 'border-amber-400/25', mark: 'bg-amber-300' },
  unavailable: { text: 'text-rose-300', border: 'border-rose-400/25', mark: 'bg-rose-300' },
  unknown: { text: 'text-slate-400', border: 'border-slate-500/25', mark: 'bg-slate-500' },
};

export default function SystemHealth() {
  const { data, isPending, isFetching, isError, refetch, dataUpdatedAt } = useQuery({
    queryKey: ['system-health'],
    queryFn: fetchSystemHealth,
    refetchInterval: 15_000,
    staleTime: 5_000,
    retry: 1,
  });
  const overall = getOverallHealthState(data, isError);
  const checks = Array.isArray(data?.checks) ? data.checks : [];
  const snapshotFresh = !isError && isFreshHealthSnapshot(data);
  // Keep last-known detail visible, but never leave old green labels in place
  // when this snapshot or a component timestamp can no longer be verified.
  const displayedChecks = checks.map(check => (
    !snapshotFresh || (check.status === 'healthy' && !isFreshHealthCheck(check))
      ? { ...check, status: 'unknown' as const }
      : check
  ));
  const showVerificationAlert = isError || (Boolean(data) && !snapshotFresh);
  const healthyCount = displayedChecks.filter(check => check.status === 'healthy').length;
  const title = overall === 'healthy' ? 'Core checks pass' : overall === 'unavailable' ? 'Core dependency unavailable' : overall === 'degraded' ? 'Degraded' : 'Status unknown';
  const statusText = overall === 'healthy'
    ? 'Every check monitored by the core API health endpoint passed. This is not a claim that every Sonalit subsystem is healthy.'
    : overall === 'unavailable'
      ? 'A required core dependency is unavailable. Review the failed probe in the component ledger.'
      : overall === 'degraded'
        ? 'One or more core dependencies need attention or could not be fully verified.'
        : 'A current, verifiable core health picture is unavailable. No healthy state is being assumed.';
  const coverageNote = data?.coverage?.not_monitored?.length
    ? `Not monitored by this endpoint: ${data.coverage.not_monitored.join(', ')}.`
    : 'This endpoint covers core API dependencies only; worker, realtime, delivery-provider, external-provider and frontend health are not asserted.';
  const StateMark = overall === 'healthy' ? ShieldCheck : overall === 'unavailable' || overall === 'degraded' ? ShieldAlert : CircleHelp;
  const statusColor = overall === 'healthy' ? 'text-emerald-200' : overall === 'unavailable' ? 'text-rose-200' : overall === 'degraded' ? 'text-amber-200' : 'text-slate-300';
  const statusBorder = overall === 'healthy' ? 'border-emerald-400/20' : overall === 'unavailable' ? 'border-rose-400/25' : overall === 'degraded' ? 'border-amber-400/20' : 'border-white/10';

  return (
    <main className="min-h-full bg-[#070d16] px-4 py-6 text-slate-100 sm:px-6 lg:px-9 lg:py-8">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-white/[.08] pb-5">
          <div>
            <div className="flex items-center gap-2 font-mono text-[10px] font-semibold uppercase tracking-[.22em] text-slate-500">
              <Activity size={13} /> Operations / Runtime evidence
            </div>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">System health</h1>
            <p className="mt-2 max-w-xl text-sm leading-6 text-slate-400">
              Core API dependency evidence only. Missing, stale or failed checks are never displayed as healthy.
            </p>
          </div>
          <button
            type="button"
            onClick={() => { void refetch(); }}
            disabled={isFetching}
            className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/[.03] px-3 py-2 text-xs font-medium text-slate-300 transition hover:border-white/20 hover:bg-white/[.06] disabled:cursor-wait disabled:opacity-60"
          >
            <RefreshCw size={14} className={isFetching ? 'animate-spin' : ''} />
            {isFetching ? 'Checking…' : 'Run check'}
          </button>
        </div>

        <section className="mt-6 grid gap-3 lg:grid-cols-[1.45fr_1fr_1fr]">
          <article className={`rounded-xl border ${statusBorder} bg-[#0b1420] p-5 sm:p-6`}>
            <div className="flex items-center justify-between gap-3">
              <span className="font-mono text-[10px] uppercase tracking-[.18em] text-slate-500">Overall state</span>
              <StateMark size={19} strokeWidth={1.7} className={statusColor} />
            </div>
            <div className={`mt-4 text-2xl font-semibold tracking-tight ${statusColor}`}>{isPending ? 'Checking…' : title}</div>
            <p className="mt-2 max-w-md text-sm leading-5 text-slate-400">{statusText}</p>
            <div className="mt-5 border-t border-white/[.07] pt-3 text-[11px] text-slate-500">
              {checks.length ? `${healthyCount} of ${checks.length} checks healthy` : 'No check results available'}
              {isError ? ' · Latest response unverified' : ''}
            </div>
          </article>

          <article className="rounded-xl border border-white/[.08] bg-[#0b1420] p-5">
            <div className="flex items-center gap-2 text-slate-500">
              <Clock3 size={14} />
              <span className="font-mono text-[10px] uppercase tracking-[.16em]">Last backend check</span>
            </div>
            <div className="mt-4 text-lg font-medium text-slate-100">{formatAge(data?.timestamp)}</div>
            <p className="mt-2 text-xs leading-5 text-slate-500">
              {data?.timestamp && Number.isFinite(new Date(data.timestamp).getTime())
                ? new Date(data.timestamp).toLocaleString()
                : 'No valid backend timestamp was returned.'}
            </p>
          </article>

          <article className="rounded-xl border border-white/[.08] bg-[#0b1420] p-5">
            <div className="flex items-center gap-2 text-slate-500">
              <Activity size={14} />
              <span className="font-mono text-[10px] uppercase tracking-[.16em]">API process uptime</span>
            </div>
            <div className="mt-4 text-lg font-medium text-slate-100">{formatUptime(data?.uptime_seconds)}</div>
            <p className="mt-2 text-xs leading-5 text-slate-500">Time since this API process started; not overall platform uptime.</p>
          </article>
        </section>

        <p className="mt-4 rounded-lg border border-white/[.07] bg-white/[.02] px-4 py-3 text-xs leading-5 text-slate-400">
          <span className="mr-2 font-mono text-[10px] uppercase tracking-[.14em] text-slate-500">Coverage boundary</span>
          {coverageNote}
        </p>

        <section className="mt-8">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <div className="font-mono text-[10px] font-semibold uppercase tracking-[.2em] text-slate-500">Dependency ledger</div>
              <h2 className="mt-1 text-lg font-semibold text-slate-100">Reported checks</h2>
            </div>
            <span className="font-mono text-[10px] text-slate-500">REFRESH · 15 SEC</span>
          </div>

          <div className="mt-4 overflow-hidden rounded-xl border border-white/[.08] bg-[#0a121d]">
            <div className="hidden grid-cols-[minmax(150px,1fr)_125px_minmax(150px,1.2fr)_minmax(120px,.8fr)] gap-4 border-b border-white/[.08] px-5 py-3 font-mono text-[9px] uppercase tracking-[.16em] text-slate-500 md:grid">
              <span>Component</span><span>State</span><span>Evidence</span><span>Last checked</span>
            </div>
            {isPending && !data ? (
              <div className="px-5 py-10 text-sm text-slate-400">Waiting for the health endpoint to return evidence…</div>
            ) : displayedChecks.length ? displayedChecks.map(check => {
              const styles = STATE_STYLES[check.status] ?? STATE_STYLES.unknown;
              return (
                <div key={check.id} className="grid gap-3 border-b border-white/[.06] px-4 py-4 last:border-0 sm:px-5 md:grid-cols-[minmax(150px,1fr)_125px_minmax(150px,1.2fr)_minmax(120px,.8fr)] md:items-center md:gap-4">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-slate-200">{check.label}</div>
                    <div className="mt-1 break-all font-mono text-[10px] text-slate-600">{check.id}</div>
                  </div>
                  <div>
                    <span className={`inline-flex items-center gap-2 rounded-md border ${styles.border} px-2 py-1 text-[11px] ${styles.text}`}>
                      <span className={`h-1.5 w-1.5 rounded-[1px] ${styles.mark}`} />
                      {checkStateLabel(check.status)}
                    </span>
                  </div>
                  <p className="text-xs leading-5 text-slate-400">{check.detail || 'No diagnostic detail supplied.'}</p>
                  <div className="text-xs text-slate-400">
                    {formatAge(check.checked_at)}
                    {check.checked_at && Number.isFinite(new Date(check.checked_at).getTime()) && (
                      <div className="mt-1 text-[10px] text-slate-600">{new Date(check.checked_at).toLocaleTimeString()}</div>
                    )}
                  </div>
                </div>
              );
            }) : (
              <div className="px-5 py-8">
                <p className="text-sm font-medium text-slate-300">No verifiable check results</p>
                <p className="mt-2 max-w-2xl text-xs leading-5 text-slate-500">
                  The response did not include a health-check ledger, or the endpoint could not be reached. The application will not infer that dependencies are healthy.
                </p>
              </div>
            )}
          </div>
        </section>

        {showVerificationAlert && (
          <div role="alert" className="mt-5 flex items-start gap-3 rounded-lg border border-amber-400/20 bg-amber-400/[.04] p-4 text-sm text-amber-100/90">
            <CircleHelp size={17} className="mt-0.5 shrink-0" />
            <div>
              <div className="font-medium">The latest health response could not be verified.</div>
              <p className="mt-1 text-xs leading-5 text-amber-100/60">The header will show STATUS UNKNOWN until a valid, current health response is received.</p>
            </div>
          </div>
        )}

        <div className="mt-6 flex flex-wrap items-center justify-between gap-2 border-t border-white/[.07] pt-4 text-[10px] text-slate-600">
          <span>SONALIT · SYSTEM HEALTH</span>
          <span>{dataUpdatedAt ? `Client received update ${formatAge(new Date(dataUpdatedAt).toISOString())}` : 'No successful response received in this session'}</span>
        </div>
      </div>
    </main>
  );
}
