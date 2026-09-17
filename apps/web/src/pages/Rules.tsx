import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity, Bell, ChevronRight, Code2, Copy, FlaskConical,
  GitBranch, History, Layers3, PauseCircle, PlayCircle, Plus,
  Radio, ShieldAlert, SlidersHorizontal, Trash2, Webhook, X, Zap
} from 'lucide-react';
import { rulesAPI } from '../lib/api.js';

type Condition = {
  field: string;
  operator: string;
  value?: unknown;
};

type Action = {
  type: string;
  channel?: string;
  recipient?: string;
  template?: string;
};

type Rule = {
  id: string;
  name: string;
  description?: string | null;
  enabled: boolean;
  status?: string;
  priority?: number;
  severity?: string;
  mode?: string;
  version?: number;
  conditions?: Condition[];
  condition_logic?: 'all' | 'any';
  actions?: Action[];
  cooldown_seconds?: number;
  evaluation_window_seconds?: number;
  last_triggered_at?: string | null;
  trigger_count?: number;
  failure_count?: number;
  tags?: string[];
};

type Execution = {
  id: string;
  event_type: string;
  subject_id?: string;
  matched: boolean;
  suppressed: boolean;
  suppression_reason?: string | null;
  decision_ms?: number | null;
  condition_trace?: Array<{ field: string; operator: string; expected?: unknown; actual?: unknown; matched: boolean }>;
  action_results?: Array<{ type: string; status: string; error?: string }>;
  evaluated_at: string;
};

const CONDITION_FIELDS = [
  ['speed_kmh', 'Vehicle speed'],
  ['location.lat', 'Latitude'],
  ['location.lon', 'Longitude'],
  ['device_id', 'Device'],
  ['event.type', 'Event type'],
  ['geofence.inside', 'Inside geofence'],
  ['battery.level', 'Battery level'],
  ['route.deviation_km', 'Route deviation'],
  ['idle.seconds', 'Idle duration'],
  ['signal.rssi', 'Signal strength'],
];

const OPERATORS = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'not_in', 'contains', 'exists', 'between'];

const ACTIONS = [
  ['alert', 'Create alert', Bell],
  ['create_incident', 'Create incident', ShieldAlert],
  ['notify', 'Notify', Radio],
  ['webhook', 'Webhook', Webhook],
  ['escalate', 'Escalate', Activity],
  ['tag', 'Tag object', Layers3],
  ['log', 'Write audit event', History],
];

const TEMPLATES = [
  {
    name: 'Critical overspeed',
    description: 'Escalate sustained overspeed events from active vehicles.',
    severity: 'critical',
    conditions: [{ field: 'speed_kmh', operator: 'gt', value: 110 }],
    actions: [{ type: 'alert', severity: 'critical' }, { type: 'notify', channel: 'email' }],
  },
  {
    name: 'Route deviation guard',
    description: 'Detect meaningful deviation from the approved corridor.',
    severity: 'high',
    conditions: [{ field: 'route.deviation_km', operator: 'gt', value: 2 }],
    actions: [{ type: 'alert', severity: 'high' }, { type: 'create_incident', severity: 'high' }],
  },
  {
    name: 'Device silence',
    description: 'Turn telemetry silence into an operational signal.',
    severity: 'high',
    conditions: [{ field: 'event.type', operator: 'eq', value: 'device.offline' }],
    actions: [{ type: 'alert', severity: 'high' }, { type: 'notify', channel: 'in_app' }],
  },
];

function fmtDuration(sec: number | undefined) {
  if (!sec) return 'off';
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.round(sec / 60)}m`;
  return `${(sec / 3600).toFixed(1)}h`;
}

function conditionText(c: Condition) {
  const label = CONDITION_FIELDS.find(([field]) => field === c.field)?.[1] ?? c.field;
  return `${label} ${c.operator} ${Array.isArray(c.value) ? c.value.join(', ') : String(c.value ?? '')}`.trim();
}

function actionText(a: Action) {
  return ACTIONS.find(([type]) => type === a.type)?.[1] ?? a.type;
}

export default function Rules() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<'rules' | 'executions' | 'templates'>('rules');
  const [search, setSearch] = useState('');
  const [severity, setSeverity] = useState('all');
  const [status, setStatus] = useState('all');
  const [builder, setBuilder] = useState(false);
  const [selected, setSelected] = useState<Rule | null>(null);
  const [editing, setEditing] = useState<Rule | null>(null);
  const [testInput, setTestInput] = useState('{"speed_kmh": 120, "device_id": "demo-truck", "location": {"lat": -1.28, "lon": 36.82}}');
  const [testResult, setTestResult] = useState<unknown>(null);

  const rulesQ = useQuery({
    queryKey: ['rules'],
    queryFn: async () => {
      const r = await rulesAPI.list();
      const body = r.data as { data?: Rule[] };
      return body.data ?? [];
    },
  });

  const statsQ = useQuery({
    queryKey: ['rules-stats'],
    queryFn: async () => (await rulesAPI.stats()).data?.data ?? {},
  });

  const visibleRules = useMemo(() => {
    const rules = rulesQ.data ?? [];
    return rules.filter((r) => {
      const text = `${r.name} ${r.description ?? ''} ${(r.tags ?? []).join(' ')}`.toLowerCase();
      return (!search || text.includes(search.toLowerCase()))
        && (severity === 'all' || (r.severity ?? 'medium') === severity)
        && (status === 'all' || (r.status ?? (r.enabled ? 'active' : 'paused')) === status);
    });
  }, [rulesQ.data, search, severity, status]);

  const toggleM = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => rulesAPI.toggle(id, enabled),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['rules'] }),
  });

  const deleteM = useMutation({
    mutationFn: (id: string) => rulesAPI.remove(id),
    onSuccess: () => {
      setSelected(null);
      qc.invalidateQueries({ queryKey: ['rules'] });
    },
  });

  const testM = useMutation({
    mutationFn: ({ id, data }: { id: string; data: unknown }) => rulesAPI.test(id, data),
    onSuccess: (r) => setTestResult(r.data?.data),
  });

  const stats = statsQ.data as Record<string, unknown>;
  const active = Number(stats?.active ?? (rulesQ.data ?? []).filter((r) => r.enabled).length);
  const total = Number(stats?.total ?? (rulesQ.data ?? []).length);
  const executions = Number(stats?.executions ?? 0);
  const failures = Number(stats?.failures ?? 0);

  return (
    <div className="min-h-full bg-[#071014] text-slate-100">
      <div className="sticky top-0 z-20 border-b border-white/[0.06] bg-[#071014]/95 backdrop-blur-xl">
        <div className="px-6 py-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-orange-400/20 bg-orange-400/10">
                <Zap size={18} className="text-orange-300" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-lg font-semibold tracking-wide">Rules Control Plane</h1>
                  <span className="rounded-full border border-emerald-400/20 bg-emerald-400/5 px-2 py-0.5 text-[10px] font-mono text-emerald-300">LIVE</span>
                </div>
                <p className="text-xs text-slate-500">Deterministic automation · versioned policies · explainable executions</p>
              </div>
            </div>
            <button
              onClick={() => { setEditing(null); setBuilder(true); }}
              className="flex items-center gap-2 rounded-lg bg-orange-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-orange-400"
            >
              <Plus size={15} /> New rule
            </button>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-2 md:grid-cols-4">
            {[
              ['Rules', total, Layers3],
              ['Active', active, PlayCircle],
              ['Executions', executions, Activity],
              ['Failures', failures, ShieldAlert],
            ].map(([label, value, Icon]) => (
              <div key={String(label)} className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3">
                <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.16em] text-slate-500">
                  <span>{String(label)}</span><Icon size={13} className="text-slate-600" />
                </div>
                <div className="mt-1 text-xl font-semibold tabular-nums">{String(value)}</div>
              </div>
            ))}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            {[
              ['rules', 'Rules', Layers3],
              ['executions', 'Execution ledger', Activity],
              ['templates', 'Rule library', Copy],
            ].map(([key, label, Icon]) => (
              <button
                key={key}
                onClick={() => setTab(key as typeof tab)}
                className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs ${tab === key ? 'bg-white/[0.07] text-white' : 'text-slate-500 hover:bg-white/[0.03] hover:text-slate-300'}`}
              >
                <Icon size={13} /> {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="px-6 py-5">
        {tab === 'rules' && (
          <>
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <div className="relative min-w-[240px] flex-1">
                <SlidersHorizontal size={14} className="absolute left-3 top-3 text-slate-600" />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search rules, tags, descriptions…" className="w-full rounded-lg border border-white/[0.07] bg-white/[0.025] py-2.5 pl-9 pr-3 text-xs outline-none placeholder:text-slate-600 focus:border-orange-400/30" />
              </div>
              <select value={severity} onChange={(e) => setSeverity(e.target.value)} className="rounded-lg border border-white/[0.07] bg-[#0a151a] px-3 py-2.5 text-xs text-slate-300 outline-none">
                <option value="all">All severities</option><option value="critical">Critical</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
              </select>
              <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-lg border border-white/[0.07] bg-[#0a151a] px-3 py-2.5 text-xs text-slate-300 outline-none">
                <option value="all">All states</option><option value="active">Active</option><option value="paused">Paused</option><option value="draft">Draft</option><option value="error">Error</option>
              </select>
            </div>

            <div className="overflow-hidden rounded-xl border border-white/[0.06] bg-white/[0.018]">
              <div className="grid grid-cols-[1.5fr_1.2fr_180px_150px_120px] gap-4 border-b border-white/[0.06] px-5 py-3 text-[10px] uppercase tracking-[0.14em] text-slate-600">
                <span>Rule</span><span>Logic</span><span>Runtime</span><span>Health</span><span className="text-right">Controls</span>
              </div>
              {(rulesQ.data === undefined) && <div className="px-5 py-12 text-center text-sm text-slate-500">Loading rules…</div>}
              {rulesQ.data !== undefined && visibleRules.length === 0 && <div className="px-5 py-16 text-center text-sm text-slate-500">No rules match the current filters.</div>}
              {visibleRules.map((rule) => (
                <button key={rule.id} onClick={() => setSelected(rule)} className="grid w-full grid-cols-[1.5fr_1.2fr_180px_150px_120px] items-center gap-4 border-b border-white/[0.045] px-5 py-4 text-left transition hover:bg-white/[0.025]">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`h-2 w-2 rounded-full ${rule.enabled ? 'bg-emerald-400' : 'bg-slate-700'}`} />
                      <span className="truncate text-sm font-medium">{rule.name}</span>
                      <span className="rounded border border-white/[0.06] px-1.5 py-0.5 text-[9px] font-mono text-slate-600">v{rule.version ?? 1}</span>
                    </div>
                    <p className="mt-1 truncate pl-4 text-[11px] text-slate-600">{rule.description || 'No description'}</p>
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-[11px] text-blue-300">{(rule.condition_logic ?? 'all').toUpperCase()} · {(rule.conditions?.length ?? 0)} conditions</div>
                    <div className="mt-1 truncate text-[10px] text-slate-600">{rule.conditions?.slice(0,2).map(conditionText).join(' · ')}</div>
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-300">{(rule.actions ?? []).map(actionText).join(' + ') || 'No actions'}</div>
                    <div className="mt-1 text-[10px] text-slate-600">cooldown {fmtDuration(rule.cooldown_seconds)}</div>
                  </div>
                  <div>
                    <span className={`rounded-md border px-2 py-1 text-[10px] uppercase ${rule.status === 'error' ? 'border-red-400/20 bg-red-400/5 text-red-300' : rule.enabled ? 'border-emerald-400/20 bg-emerald-400/5 text-emerald-300' : 'border-white/[0.08] text-slate-500'}`}>{rule.status ?? (rule.enabled ? 'active' : 'paused')}</span>
                    <div className="mt-1 text-[10px] text-slate-600">{Number(rule.trigger_count ?? 0).toLocaleString()} triggers</div>
                  </div>
                  <div className="flex justify-end gap-1">
                    <span onClick={(e) => { e.stopPropagation(); toggleM.mutate({ id: rule.id, enabled: !rule.enabled }); }} className="rounded-md p-2 text-slate-500 hover:bg-white/[0.06] hover:text-white">
                      {rule.enabled ? <PauseCircle size={15} /> : <PlayCircle size={15} />}
                    </span>
                    <span className="rounded-md p-2 text-slate-600"><ChevronRight size={15} /></span>
                  </div>
                </button>
              ))}
            </div>
          </>
        )}

        {tab === 'templates' && (
          <div className="grid gap-4 md:grid-cols-3">
            {TEMPLATES.map((template) => (
              <div key={template.name} className="rounded-xl border border-white/[0.06] bg-white/[0.018] p-5">
                <div className="flex items-center justify-between">
                  <span className="rounded-full border border-orange-400/20 bg-orange-400/5 px-2 py-1 text-[9px] uppercase tracking-[0.12em] text-orange-300">{template.severity}</span>
                  <Zap size={14} className="text-slate-700" />
                </div>
                <h3 className="mt-4 text-sm font-semibold">{template.name}</h3>
                <p className="mt-1 text-xs leading-5 text-slate-500">{template.description}</p>
                <div className="mt-4 rounded-lg border border-white/[0.05] bg-black/10 p-3 text-[10px]">
                  <div className="text-blue-300">IF {template.conditions.map(conditionText).join(` ${'AND'} `)}</div>
                  <div className="my-1 text-slate-700">→</div>
                  <div className="text-orange-300">THEN {template.actions.map(actionText).join(' + ')}</div>
                </div>
                <button
                  className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg border border-white/[0.08] py-2 text-xs text-slate-300 hover:bg-white/[0.04]"
                  onClick={() => {
                    setEditing({
                      id: '', name: template.name, description: template.description, enabled: true, status: 'draft', priority: 50,
                      severity: template.severity, mode: 'dry_run', version: 1, conditions: template.conditions, condition_logic: 'all',
                      actions: template.actions, cooldown_seconds: 900, tags: ['template'],
                    });
                    setBuilder(true);
                  }}
                >
                  <Copy size={13} /> Use template
                </button>
              </div>
            ))}
          </div>
        )}

        {tab === 'executions' && (
          <ExecutionLedger rules={rulesQ.data ?? []} onSelect={(r) => setSelected(r)} />
        )}
      </div>

      {selected && (
        <RuleDrawer
          rule={selected}
          onClose={() => setSelected(null)}
          onEdit={() => { setEditing(selected); setSelected(null); setBuilder(true); }}
          onDelete={() => deleteM.mutate(selected.id)}
          onTest={(data) => testM.mutate({ id: selected.id, data })}
          testInput={testInput}
          setTestInput={setTestInput}
          testResult={testResult}
          setTestResult={setTestResult}
        />
      )}

      {builder && (
        <RuleBuilder
          initial={editing}
          onClose={() => { setBuilder(false); setEditing(null); }}
          onSaved={() => { setBuilder(false); setEditing(null); qc.invalidateQueries({ queryKey: ['rules'] }); qc.invalidateQueries({ queryKey: ['rules-stats'] }); }}
        />
      )}
    </div>
  );
}

function ExecutionLedger({ rules, onSelect }: { rules: Rule[]; onSelect: (rule: Rule) => void }) {
  const first = rules.find((r) => Number(r.trigger_count ?? 0) > 0) ?? rules[0];
  const q = useQuery({
    queryKey: ['rule-executions', first?.id],
    queryFn: async () => {
      if (!first?.id) return [] as Execution[];
      return ((await rulesAPI.executions(first.id, 100)).data?.data ?? []) as Execution[];
    },
    enabled: Boolean(first?.id),
  });
  return (
    <div className="overflow-hidden rounded-xl border border-white/[0.06] bg-white/[0.018]">
      <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-4">
        <div><div className="text-sm font-semibold">Execution ledger</div><div className="mt-1 text-xs text-slate-600">Auditable rule decisions for {first?.name ?? 'the selected rule'}.</div></div>
        <span className="rounded-lg border border-white/[0.06] px-2 py-1 text-[10px] font-mono text-slate-500">{q.data?.length ?? 0} recent</span>
      </div>
      {q.isLoading && <div className="px-5 py-12 text-center text-sm text-slate-500">Loading execution history…</div>}
      {q.data?.map((x) => (
        <div key={x.id} className="grid grid-cols-[1.3fr_130px_110px_1fr] gap-4 border-b border-white/[0.04] px-5 py-4">
          <div><div className="text-xs font-medium">{x.event_type}</div><div className="mt-1 text-[10px] text-slate-600">{x.subject_id ?? '—'} · {new Date(x.evaluated_at).toLocaleString()}</div></div>
          <div><span className={`rounded px-2 py-1 text-[10px] ${x.suppressed ? 'bg-amber-400/5 text-amber-300' : x.matched ? 'bg-emerald-400/5 text-emerald-300' : 'bg-slate-400/5 text-slate-500'}`}>{x.suppressed ? 'suppressed' : x.matched ? 'matched' : 'not matched'}</span></div>
          <div className="text-[10px] text-slate-600">{x.decision_ms ?? '—'} ms</div>
          <div className="truncate text-[10px] text-slate-600">{x.suppression_reason ?? x.action_results?.map((a) => `${a.type}:${a.status}`).join(' · ') ?? '—'}</div>
        </div>
      ))}
      {q.data?.length === 0 && !q.isLoading && <div className="px-5 py-12 text-center text-sm text-slate-600">No executions recorded yet.</div>}
      {first && <button onClick={() => onSelect(first)} className="flex w-full items-center justify-center gap-2 py-3 text-xs text-slate-500 hover:text-white"><ChevronRight size={13} /> Open rule detail</button>}
    </div>
  );
}

function RuleDrawer({
  rule, onClose, onEdit, onDelete, onTest, testInput, setTestInput, testResult, setTestResult,
}: {
  rule: Rule; onClose: () => void; onEdit: () => void; onDelete: () => void; onTest: (data: unknown) => void;
  testInput: string; setTestInput: (v: string) => void; testResult: unknown; setTestResult: (v: unknown) => void;
}) {
  const [mode, setMode] = useState<'overview' | 'test'>('overview');
  const q = useQuery({
    queryKey: ['rule-executions', rule.id, 'drawer'],
    queryFn: async () => ((await rulesAPI.executions(rule.id, 40)).data?.data ?? []) as Execution[],
  });
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50">
      <div className="h-full w-full max-w-[620px] overflow-y-auto border-l border-white/[0.08] bg-[#081217] shadow-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-white/[0.06] bg-[#081217]/95 px-5 py-4 backdrop-blur">
          <div><div className="text-xs uppercase tracking-[0.16em] text-slate-600">Rule detail</div><div className="mt-1 text-base font-semibold">{rule.name}</div></div>
          <button onClick={onClose} className="rounded-lg p-2 text-slate-500 hover:bg-white/[0.05] hover:text-white"><X size={16} /></button>
        </div>
        <div className="px-5 py-5">
          <div className="grid grid-cols-3 gap-2">
            {[['status', rule.status ?? (rule.enabled ? 'active' : 'paused')], ['version', `v${rule.version ?? 1}`], ['severity', rule.severity ?? 'medium']].map(([k,v]) => <div key={String(k)} className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3"><div className="text-[9px] uppercase tracking-[0.14em] text-slate-600">{String(k)}</div><div className="mt-1 text-xs">{String(v)}</div></div>)}
          </div>
          <div className="mt-5 flex gap-1 rounded-lg border border-white/[0.06] bg-white/[0.02] p-1">
            {['overview','test'].map((x) => <button key={x} onClick={() => setMode(x as 'overview'|'test')} className={`flex-1 rounded-md py-2 text-xs ${mode === x ? 'bg-white/[0.07] text-white' : 'text-slate-500'}`}>{x === 'test' ? 'Test / explain' : 'Overview'}</button>)}
          </div>
          {mode === 'overview' ? (
            <>
              <section className="mt-5"><h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-600">Logic</h3><div className="mt-2 rounded-xl border border-white/[0.06] bg-black/10 p-4"><div className="space-y-2">{(rule.conditions ?? []).map((c,i) => <div key={i} className="flex items-center gap-2 text-xs"><span className="rounded border border-blue-400/15 bg-blue-400/5 px-2 py-1 text-blue-300">{conditionText(c)}</span>{i < (rule.conditions?.length ?? 0)-1 && <span className="text-slate-700">{rule.condition_logic ?? 'AND'}</span>}</div>)}</div></div></section>
              <section className="mt-5"><h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-600">Actions</h3><div className="mt-2 space-y-2">{(rule.actions ?? []).map((a,i)=><div key={i} className="flex items-center gap-3 rounded-lg border border-white/[0.05] px-3 py-3"><Zap size={13} className="text-orange-300"/><div className="text-xs">{actionText(a)}</div><div className="ml-auto text-[10px] text-slate-600">{a.channel ?? a.recipient ?? ''}</div></div>)}</div></section>
              <section className="mt-5"><h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-600">Recent executions</h3><div className="mt-2 overflow-hidden rounded-xl border border-white/[0.06]">{q.data?.slice(0,8).map((x)=><div key={x.id} className="border-b border-white/[0.04] px-3 py-3"><div className="flex items-center justify-between"><span className="text-xs">{x.event_type}</span><span className="text-[10px] text-slate-600">{new Date(x.evaluated_at).toLocaleTimeString()}</span></div><div className="mt-1 text-[10px] text-slate-600">{x.suppressed ? `suppressed · ${x.suppression_reason}` : x.matched ? 'matched and actioned' : 'evaluated without match'}</div></div>)}</div></section>
              <div className="mt-6 flex gap-2"><button onClick={onEdit} className="flex-1 rounded-lg bg-white/[0.06] py-2.5 text-xs hover:bg-white/[0.09]">Edit rule</button><button onClick={onDelete} className="rounded-lg border border-red-400/15 px-3 text-red-300 hover:bg-red-400/5"><Trash2 size={14}/></button></div>
            </>
          ) : (
            <section className="mt-5">
              <div className="rounded-xl border border-white/[0.06] bg-black/10 p-4">
                <div className="mb-2 flex items-center gap-2 text-xs font-medium"><FlaskConical size={13} className="text-orange-300"/> Dry-run against sample event</div>
                <textarea value={testInput} onChange={(e) => setTestInput(e.target.value)} rows={10} className="mt-3 w-full rounded-lg border border-white/[0.06] bg-[#050a0d] p-3 font-mono text-[11px] text-slate-300 outline-none" />
                <button onClick={() => { try { onTest(JSON.parse(testInput)); } catch { setTestResult({ error: 'Invalid JSON input' }); } }} className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-orange-500 py-2.5 text-xs font-semibold text-slate-950"><Code2 size={13}/> Evaluate without side effects</button>
              </div>
              {testResult !== null && <pre className="mt-3 overflow-auto rounded-xl border border-white/[0.06] bg-[#050a0d] p-4 text-[10px] text-slate-400">{JSON.stringify(testResult, null, 2)}</pre>}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

function RuleBuilder({ initial, onClose, onSaved }: { initial: Rule | null; onClose: () => void; onSaved: () => void }) {
  const existing = initial ?? {
    id: '', name: '', description: '', enabled: true, status: 'draft', priority: 50, severity: 'medium', mode: 'live', version: 1,
    conditions: [{ field: 'speed_kmh', operator: 'gt', value: 110 }],
    condition_logic: 'all' as const, actions: [{ type: 'alert', severity: 'high' }], cooldown_seconds: 900, evaluation_window_seconds: 0, tags: [],
  };
  const [form, setForm] = useState<Rule>(existing);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const conditions = form.conditions ?? [];
  const actions = form.actions ?? [];

  async function save() {
    setSaving(true); setError('');
    try {
      const payload = {
        name: form.name, description: form.description, enabled: form.enabled, status: form.status, priority: Number(form.priority ?? 50),
        severity: form.severity ?? 'medium', mode: form.mode ?? 'live', conditions, condition_logic: form.condition_logic ?? 'all',
        actions, cooldown_seconds: Number(form.cooldown_seconds ?? 900), evaluation_window_seconds: Number(form.evaluation_window_seconds ?? 0),
        tags: form.tags ?? [], scope: { type: 'org' }, schedule: { enabled: false },
      };
      if (form.id) await rulesAPI.update(form.id, payload); else await rulesAPI.create(payload);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save rule');
    } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 p-3 backdrop-blur-sm">
      <div className="mx-auto flex h-full max-w-[980px] flex-col overflow-hidden rounded-2xl border border-white/[0.08] bg-[#081217] shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/[0.06] px-6 py-4">
          <div><div className="text-[10px] uppercase tracking-[0.16em] text-orange-300">Rule builder</div><div className="mt-1 text-base font-semibold">{form.id ? 'Edit rule' : 'Create rule'}</div></div>
          <button onClick={onClose} className="rounded-lg p-2 text-slate-500 hover:bg-white/[0.05] hover:text-white"><X size={16}/></button>
        </div>
        <div className="flex-1 overflow-y-auto p-6">
          <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
            <div className="space-y-5">
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
                <div className="grid gap-3 md:grid-cols-2">
                  <input value={form.name ?? ''} onChange={(e) => setForm({...form,name:e.target.value})} placeholder="Rule name" className="rounded-lg border border-white/[0.06] bg-[#050a0d] px-3 py-2.5 text-xs outline-none"/>
                  <select value={form.severity ?? 'medium'} onChange={(e) => setForm({...form,severity:e.target.value})} className="rounded-lg border border-white/[0.06] bg-[#050a0d] px-3 text-xs"><option>low</option><option>medium</option><option>high</option><option>critical</option></select>
                  <input value={form.description ?? ''} onChange={(e) => setForm({...form,description:e.target.value})} placeholder="What this rule protects / automates" className="md:col-span-2 rounded-lg border border-white/[0.06] bg-[#050a0d] px-3 py-2.5 text-xs outline-none"/>
                </div>
              </div>

              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
                <div className="mb-3 flex items-center justify-between"><div><div className="text-xs font-semibold">WHEN</div><div className="text-[10px] text-slate-600">All conditions must match unless ANY is selected.</div></div><select value={form.condition_logic ?? 'all'} onChange={(e)=>setForm({...form,condition_logic:e.target.value as 'all'|'any'})} className="rounded-lg border border-white/[0.06] bg-[#050a0d] px-2 py-1.5 text-[10px]"><option value="all">ALL</option><option value="any">ANY</option></select></div>
                <div className="space-y-2">
                  {conditions.map((c,i)=>(
                    <div key={i} className="grid grid-cols-[1.2fr_110px_1fr_36px] gap-2">
                      <select value={c.field} onChange={(e)=>{const next=[...conditions];next[i]={...c,field:e.target.value};setForm({...form,conditions:next});}} className="rounded-lg border border-white/[0.06] bg-[#050a0d] px-2 py-2 text-[11px]"><option value="" disabled>Select field</option>{CONDITION_FIELDS.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select>
                      <select value={c.operator} onChange={(e)=>{const next=[...conditions];next[i]={...c,operator:e.target.value};setForm({...form,conditions:next});}} className="rounded-lg border border-white/[0.06] bg-[#050a0d] px-2 py-2 text-[11px]">{OPERATORS.map(v=><option key={v}>{v}</option>)}</select>
                      <input value={Array.isArray(c.value)?c.value.join(','):String(c.value ?? '')} onChange={(e)=>{const raw=e.target.value;const value=['in','not_in','between'].includes(c.operator)?raw.split(',').map(x=>x.trim()).filter(Boolean):raw;const next=[...conditions];next[i]={...c,value};setForm({...form,conditions:next});}} placeholder="Value" className="rounded-lg border border-white/[0.06] bg-[#050a0d] px-2 py-2 text-[11px]"/>
                      <button onClick={()=>setForm({...form,conditions:conditions.filter((_,x)=>x!==i)})} className="rounded-lg border border-white/[0.06] text-slate-600 hover:text-red-300"><Trash2 size={13}/></button>
                    </div>
                  ))}
                </div>
                <button onClick={()=>setForm({...form,conditions:[...conditions,{field:'speed_kmh',operator:'gt',value:100}]})} className="mt-3 flex items-center gap-1.5 text-[10px] text-orange-300 hover:text-orange-200"><Plus size={12}/> Add condition</button>
              </div>

              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
                <div className="mb-3"><div className="text-xs font-semibold">THEN</div><div className="text-[10px] text-slate-600">Actions execute in order and each result is recorded.</div></div>
                <div className="space-y-2">
                  {actions.map((a,i)=>{
                    const ActionIcon = ACTIONS.find(([t])=>t===a.type)?.[2] ?? Zap;
                    return <div key={i} className="grid grid-cols-[160px_1fr_36px] gap-2">
                      <div className="flex items-center gap-2 rounded-lg border border-white/[0.06] bg-[#050a0d] px-3"><ActionIcon size={12} className="text-orange-300"/><select value={a.type} onChange={(e)=>{const next=[...actions];next[i]={...a,type:e.target.value};setForm({...form,actions:next});}} className="w-full bg-transparent py-2 text-[11px] outline-none">{ACTIONS.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></div>
                      <input value={a.type === 'notify' ? (a.channel ?? '') : (a.template ?? '')} onChange={(e)=>{const next=[...actions];next[i]={...a,...(a.type==='notify'?{channel:e.target.value}:{template:e.target.value})};setForm({...form,actions:next});}} placeholder={a.type==='notify'?'channel: email / sms / in_app':'Optional template / config'} className="rounded-lg border border-white/[0.06] bg-[#050a0d] px-3 text-[11px] outline-none"/>
                      <button onClick={()=>setForm({...form,actions:actions.filter((_,x)=>x!==i)})} className="rounded-lg border border-white/[0.06] text-slate-600 hover:text-red-300"><Trash2 size={13}/></button>
                    </div>
                  })}
                </div>
                <button onClick={()=>setForm({...form,actions:[...actions,{type:'alert'}]})} className="mt-3 flex items-center gap-1.5 text-[10px] text-orange-300 hover:text-orange-200"><Plus size={12}/> Add action</button>
              </div>
            </div>

            <aside className="space-y-4">
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
                <div className="flex items-center gap-2 text-xs font-semibold"><GitBranch size={13} className="text-slate-500"/> Runtime</div>
                <label className="mt-4 block text-[10px] text-slate-600">Priority</label>
                <input type="number" value={form.priority ?? 50} onChange={(e)=>setForm({...form,priority:Number(e.target.value)})} className="mt-1 w-full rounded-lg border border-white/[0.06] bg-[#050a0d] px-3 py-2 text-xs"/>
                <label className="mt-3 block text-[10px] text-slate-600">Cooldown seconds</label>
                <input type="number" value={form.cooldown_seconds ?? 900} onChange={(e)=>setForm({...form,cooldown_seconds:Number(e.target.value)})} className="mt-1 w-full rounded-lg border border-white/[0.06] bg-[#050a0d] px-3 py-2 text-xs"/>
                <label className="mt-3 block text-[10px] text-slate-600">Mode</label>
                <select value={form.mode ?? 'live'} onChange={(e)=>setForm({...form,mode:e.target.value})} className="mt-1 w-full rounded-lg border border-white/[0.06] bg-[#050a0d] px-3 py-2 text-xs"><option value="live">Live — execute actions</option><option value="dry_run">Dry run — record only</option></select>
                <label className="mt-4 flex items-center justify-between rounded-lg border border-white/[0.05] px-3 py-2.5"><span className="text-[10px] text-slate-400">Enable after save</span><input type="checkbox" checked={form.enabled} onChange={(e)=>setForm({...form,enabled:e.target.checked})}/></label>
              </div>
              <div className="rounded-xl border border-orange-400/10 bg-orange-400/[0.025] p-4">
                <div className="flex items-center gap-2 text-xs font-semibold text-orange-200"><FlaskConical size={13}/> Safety rail</div>
                <p className="mt-2 text-[10px] leading-5 text-slate-500">Use dry-run to inspect matches before enabling a high-impact rule. Every version is retained with its execution trace.</p>
              </div>
            </aside>
          </div>
        </div>
        <div className="flex items-center justify-between border-t border-white/[0.06] px-6 py-4">
          <div className="text-[10px] text-red-300">{error}</div>
          <div className="flex gap-2"><button onClick={onClose} className="rounded-lg px-4 py-2 text-xs text-slate-500 hover:text-white">Cancel</button><button onClick={save} disabled={saving || !form.name || conditions.length===0 || actions.length===0} className="rounded-lg bg-orange-500 px-5 py-2 text-xs font-semibold text-slate-950 disabled:opacity-40">{saving ? 'Saving…' : 'Save rule'}</button></div>
        </div>
      </div>
    </div>
  );
}
