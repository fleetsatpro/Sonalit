import { useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Activity, CalendarClock, Clock3, Plane, Route, ShieldAlert } from 'lucide-react';
import { api } from '../../lib/api.js';

type Stop = {
  id: string; sequence: number; name: string; stop_type: string;
  planned_arrival_at?: string | null; planned_departure_at?: string | null;
  stop_status: 'planned' | 'reached' | 'skipped'; confirmed_at?: string | null;
  confirmation_source?: string | null;
};
type JourneyEvent = {
  id: string; event_type: string; summary: string; source: string; created_at: string;
};
type Flight = {
  id: string; sequence: number; carrier: string; flight_number: string;
  departure_airport: string; departure_airport_name?: string | null; departure_at: string; departure_timezone: string;
  arrival_airport: string; arrival_airport_name?: string | null; arrival_at: string; arrival_timezone: string;
  status: string; status_source: string; status_observed_at?: string | null;
};
type ProgrammeItem = {
  id: string; sequence: number; item_type: string; title: string; location_label?: string | null;
  planned_start_at: string; planned_end_at: string; execution_status: string;
  actual_start_at?: string | null; actual_end_at?: string | null;
  traveller_display_name?: string | null; responsible_name?: string | null; responsible_role?: string | null;
};
type ProgrammeDay = {
  id: string; journey_date: string; timezone: string; day_title: string; items: ProgrammeItem[];
};
type TravelWorkspace = { flights?: Flight[]; days?: ProgrammeDay[] };
type Filter = 'all' | 'flights' | 'programme' | 'stops' | 'operations';
type Entry = {
  id: string; kind: Exclude<Filter, 'all'>; title: string; when: string; timezone: string;
  sortAt: number; status: string; evidence: string; details: string[];
  end?: string; endTimezone?: string; observedAt?: string | null;
};

function label(value?: string | null) {
  if (!value) return 'Not recorded';
  return value.replaceAll('_', ' ').replace(/^./, first => first.toUpperCase());
}
function time(value?: string | null, timezone?: string) {
  if (!value) return 'Time not recorded';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Time unavailable';
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone || 'UTC', day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).format(date);
  } catch {
    return 'Time unavailable';
  }
}
function timestamp(value?: string | null) {
  if (!value) return Number.POSITIVE_INFINITY;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}
function flightEvidence(source?: string | null) {
  if (!source || source === 'not_recorded' || source === 'unknown') return 'Flight status source not recorded';
  return 'Status source · ' + label(source);
}
function eventEvidence(source?: string | null) {
  if (source === 'operator') return 'Recorded by an authorised team member';
  if (source === 'system') return 'Recorded by Sonalit';
  return 'Event source · ' + label(source);
}

export default function SjmOperationalTimeline({
  journeyId, timezone, stops, events, routeStatus, safetyGate, routePointCount,
}: {
  journeyId: string; timezone: string; stops: Stop[]; events: JourneyEvent[];
  routeStatus: string; safetyGate: string; routePointCount: number;
}) {
  const [filter, setFilter] = useState<Filter>('all');
  const workspaceQuery = useQuery<TravelWorkspace>({
    queryKey: ['sjm-operational-timeline', journeyId],
    queryFn: async () => (await api.get('/sjm/journeys/' + journeyId + '/travel-workspace')).data.data as TravelWorkspace,
    enabled: Boolean(journeyId),
    staleTime: 15000,
  });

  const entries = useMemo(() => {
    const result: Entry[] = [];
    for (const flight of workspaceQuery.data?.flights || []) {
      result.push({
        id: 'flight:' + flight.id, kind: 'flights',
        title: flight.carrier + ' ' + flight.flight_number,
        when: flight.departure_at, timezone: flight.departure_timezone || timezone,
        end: flight.arrival_at, endTimezone: flight.arrival_timezone || timezone,
        sortAt: timestamp(flight.departure_at), status: label(flight.status),
        evidence: flightEvidence(flight.status_source),
        observedAt: flight.status_observed_at,
        details: [
          (flight.departure_airport_name ? flight.departure_airport_name + ' · ' : '') + flight.departure_airport + ' departure',
          (flight.arrival_airport_name ? flight.arrival_airport_name + ' · ' : '') + flight.arrival_airport + ' arrival',
        ],
      });
    }
    for (const day of workspaceQuery.data?.days || []) {
      for (const item of day.items || []) {
        const hasActual = Boolean(item.actual_start_at || item.actual_end_at);
        result.push({
          id: 'programme:' + item.id, kind: 'programme', title: item.title,
          when: item.planned_start_at, timezone: day.timezone || timezone,
          end: item.planned_end_at, endTimezone: day.timezone || timezone,
          sortAt: timestamp(item.planned_start_at), status: label(item.execution_status),
          evidence: hasActual ? 'Operator-recorded execution timestamp' : 'Planned activity · no execution timestamp recorded',
          details: [
            day.day_title + ' · ' + day.journey_date,
            label(item.item_type),
            item.location_label || 'Location not recorded',
            item.traveller_display_name ? 'Traveller · ' + item.traveller_display_name : 'Shared party',
            item.responsible_name ? 'Owner · ' + item.responsible_name : item.responsible_role ? 'Accountable role · ' + label(item.responsible_role) : 'No accountable owner recorded',
            item.actual_start_at ? 'Actual start · ' + time(item.actual_start_at, day.timezone || timezone) : '',
            item.actual_end_at ? 'Actual end · ' + time(item.actual_end_at, day.timezone || timezone) : '',
          ].filter(Boolean),
        });
      }
    }
    for (const stop of stops || []) {
      const planned = stop.planned_arrival_at || stop.planned_departure_at || null;
      const recorded = stop.confirmed_at || null;
      result.push({
        id: 'stop:' + stop.id, kind: 'stops',
        title: 'Stop ' + String(stop.sequence).padStart(2, '0') + ' · ' + stop.name,
        when: planned || recorded || '', timezone,
        sortAt: timestamp(planned || recorded), status: label(stop.stop_status),
        evidence: recorded
          ? stop.confirmation_source === 'operator_confirmed'
            ? 'Operator confirmed · not GPS proof'
            : 'Confirmation source · ' + label(stop.confirmation_source)
          : 'Planned stop · no confirmation recorded',
        observedAt: recorded,
        details: [label(stop.stop_type), planned ? 'Planned · ' + time(planned, timezone) : 'No planned stop time recorded', recorded ? 'Confirmed · ' + time(recorded, timezone) : ''],
      });
    }
    for (const event of events || []) {
      result.push({
        id: 'event:' + event.id, kind: 'operations', title: event.summary || label(event.event_type),
        when: event.created_at, timezone, sortAt: timestamp(event.created_at),
        status: label(event.event_type), evidence: eventEvidence(event.source),
        details: [time(event.created_at, timezone), eventTypeDescription(event.event_type)],
      });
    }
    return result.sort((a, b) => a.sortAt - b.sortAt || a.id.localeCompare(b.id));
  }, [workspaceQuery.data, stops, events, timezone]);

  const visible = filter === 'all' ? entries : entries.filter(entry => entry.kind === filter);
  const flights = entries.filter(entry => entry.kind === 'flights').length;
  const activities = entries.filter(entry => entry.kind === 'programme').length;
  const routeStatusLabel = label(routeStatus).toUpperCase();
  const safetyGateLabel = label(safetyGate).toUpperCase();

  return <section className="space-y-4" aria-label="Unified journey timeline" data-testid="sjm-unified-timeline">
    <header className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-white/[0.08] bg-white/[0.025] p-4">
      <div className="min-w-0">
        <p className="text-[10px] font-semibold tracking-[.16em] text-emerald-200">OPERATIONS / CHRONOLOGY</p>
        <h4 className="mt-1 text-base font-semibold text-white">Unified journey timeline</h4>
        <p className="mt-1 max-w-3xl text-[11px] leading-5 text-slate-400">Flights, dated travel activities, geographic stops and recorded journey events in one chronological view. Each source keeps its own status and evidence class.</p>
      </div>
      <span className="rounded border border-white/[0.08] px-2.5 py-1.5 font-mono text-[10px] text-slate-400">{entries.length} recorded / planned entries</span>
    </header>

    <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
      <Metric icon={<Plane size={13}/>} title="Flight segments" value={String(flights)} detail="Scheduled legs, not live aircraft proof"/>
      <Metric icon={<CalendarClock size={13}/>} title="Programme activities" value={String(activities)} detail="Dated and accountable activity"/>
      <Metric icon={<Route size={13}/>} title="Geographic stops" value={String(stops.length)} detail="Route checkpoints only"/>
      <Metric icon={<Activity size={13}/>} title="Journey events" value={String(events.length)} detail="Recorded operational activity"/>
    </div>

    <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
      <EvidencePanel title="Routed geometry" value={routePointCount > 1 ? routePointCount + ' route points' : routeStatusLabel} detail={routePointCount > 1 ? 'Stored Route Safety geometry' : 'Programme activities are not road-route geometry'} />
      <EvidencePanel title="Route Safety gate" value={safetyGateLabel} detail="Only a stored Route Safety assessment determines this gate"/>
      <EvidencePanel title="Journey timezone" value={timezone || 'Not recorded'} detail="Flights retain separate departure and arrival airport time zones"/>
    </div>

    {workspaceQuery.isError && <p role="alert" className="rounded-md border border-red-300/20 bg-red-400/[0.04] p-3 text-[11px] text-red-100">The travel programme and flight register could not be loaded. No missing items are treated as complete.</p>}
    {workspaceQuery.isLoading && <p role="status" className="rounded-md border border-white/[0.07] p-3 text-[11px] text-slate-400">Loading flight and programme records…</p>}

    {routePointCount <= 1 && <div className="flex gap-2 rounded-md border border-amber-300/20 bg-amber-300/[0.035] p-3 text-[11px] leading-5 text-amber-100/90"><ShieldAlert size={14} className="mt-0.5 shrink-0"/><p>No routed road geometry is stored. Add coordinate-backed stops and run Route Safety assessment; flights and day-programme activities remain visible here but are not substituted for road route points.</p></div>}

    <div className="flex flex-wrap gap-1.5 border-b border-white/[0.07] pb-2" role="group" aria-label="Timeline filters">
      {([['all','All'],['flights','Flights'],['programme','Travel programme'],['stops','Route stops'],['operations','Journey events']] as const).map(([value,name]) =>
        <button key={value} type="button" onClick={() => setFilter(value)} aria-pressed={filter === value} className={'rounded-md border px-3 py-2 text-[11px] font-semibold transition '+(filter === value ? 'border-emerald-300/30 bg-emerald-300/[0.07] text-emerald-100' : 'border-white/[0.08] text-slate-400 hover:bg-white/[0.04] hover:text-slate-200')}>{name}</button>
      )}
    </div>

    {visible.length === 0
      ? <div className="rounded-md border border-dashed border-white/[0.10] p-8 text-center"><Clock3 size={20} className="mx-auto text-slate-500"/><p className="mt-3 text-xs font-medium text-slate-300">{entries.length ? 'No entries in this category' : 'No journey chronology has been recorded'}</p><p className="mt-1 text-[11px] leading-5 text-slate-500">{entries.length ? 'Choose another timeline filter to see the remaining records.' : 'Register flight segments, build dated programme activities or record geographic stops and operational events. The timeline will populate from those saved records.'}</p></div>
      : <ol className="space-y-2" aria-label="Chronological journey entries">
        {visible.map(entry => <li key={entry.id} className="relative rounded-md border border-white/[0.075] bg-[#0c141d] p-3 sm:p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="flex min-w-0 items-start gap-3">
              <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-md border border-white/[0.08] bg-white/[0.025] text-slate-300">{entry.kind === 'flights' ? <Plane size={14}/> : entry.kind === 'programme' ? <CalendarClock size={14}/> : entry.kind === 'stops' ? <Route size={14}/> : <Activity size={14}/>}</span>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-slate-100">{entry.title}</p>
                <p className="mt-1 text-[10px] font-mono text-slate-400">{entry.kind === 'flights' ? 'FLIGHT SEGMENT' : entry.kind === 'programme' ? 'TRAVEL PROGRAMME' : entry.kind === 'stops' ? 'GEOGRAPHIC STOP' : 'JOURNEY EVENT'}</p>
              </div>
            </div>
            <span className="rounded border border-white/[0.08] px-2 py-1 text-[10px] text-slate-300">{entry.status}</span>
          </div>
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div className="rounded border border-white/[0.05] bg-black/15 px-3 py-2">
              <p className="text-[9px] font-semibold tracking-[.12em] text-slate-500">{entry.kind === 'flights' ? 'PLANNED DEPARTURE' : entry.kind === 'programme' ? 'PLANNED START' : entry.kind === 'stops' ? 'PLANNED / RECORDED TIME' : 'RECORDED AT'}</p>
              <p className="mt-1 text-[11px] text-slate-200">{time(entry.when, entry.timezone)} <span className="text-slate-500">· {entry.timezone || 'Timezone unavailable'}</span></p>
              {entry.end && <p className="mt-1 text-[10px] text-slate-400">End / arrival · {time(entry.end, entry.endTimezone)} <span className="text-slate-500">· {entry.endTimezone || 'Timezone unavailable'}</span></p>}
            </div>
            <div className="rounded border border-white/[0.05] bg-black/15 px-3 py-2">
              <p className="text-[9px] font-semibold tracking-[.12em] text-slate-500">EVIDENCE / SOURCE</p>
              <p className="mt-1 text-[11px] leading-5 text-slate-300">{entry.evidence}</p>
              {entry.observedAt && <p className="mt-1 text-[10px] text-slate-500">Recorded / observed at · {time(entry.observedAt, entry.timezone)}</p>}
            </div>
          </div>
          {entry.details.length > 0 && <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">{entry.details.map((detail, index) => <span key={index} className="text-[10px] text-slate-500">{detail}</span>)}</div>}
        </li>)}
      </ol>}
    <p className="text-[10px] leading-5 text-slate-600">Planned times are schedules, not proof of movement. Programme execution and stop confirmations are operator-recorded unless a separately identified trusted observation is shown. Flight status is displayed with its stored source and observation time.</p>
  </section>;
}

function Metric({ icon, title, value, detail }: { icon: ReactNode; title: string; value: string; detail: string }) {
  return <div className="rounded-md border border-white/[0.07] bg-black/15 p-3"><div className="flex items-center gap-2 text-slate-400">{icon}<span className="text-[10px] font-semibold tracking-wide">{title}</span></div><p className="mt-2 font-mono text-xl font-semibold tabular-nums text-white">{value}</p><p className="mt-1 text-[9px] leading-4 text-slate-600">{detail}</p></div>;
}
function EvidencePanel({ title, value, detail }: { title: string; value: string; detail: string }) {
  return <div className="rounded-md border border-white/[0.07] bg-black/15 p-3"><p className="text-[9px] font-semibold tracking-[.12em] text-slate-500">{title}</p><p className="mt-2 break-words font-mono text-xs font-semibold text-slate-100">{value}</p><p className="mt-1 text-[10px] leading-4 text-slate-500">{detail}</p></div>;
}
function eventTypeDescription(value: string) {
  return value.replaceAll('_', ' ').toLowerCase().replace(/^./, first => first.toUpperCase());
}
