import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  CirclePause,
  CirclePlay,
  Clock3,
  Copy,
  ExternalLink,
  Filter,
  History,
  Layers3,
  Plus,
  RefreshCw,
  Search,
  Shield,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  X,
  Zap,
} from 'lucide-react';
import { rulesAPI } from '../lib/api.js';

type Condition = { field: string; operator: string; value?: unknown };
type Action = { type: string; channel?: string; recipient?: string; severity?: string };
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
  scope?: Record<string, unknown>;
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
  condition_trace?: Array<{
    field: string;
    operator: string;
    expected?: unknown;
    actual?: unknown;
    matched: boolean;
  }>;
  action_results?: Array<{ type: string; status: string; error?: string }>;
  evaluated_at: string;
};

type Tab = 'registry' | 'executions' | 'patterns';

const card = 'border border-white/[0.07] bg-[#081217]';
const input =
  'w-full border border-white/[0.08] bg-[#050d11] px-3 py-2.5 text-xs text-slate-200 outline-none transition focus:border-orange-400/40';
const fields = [
  'speed_kmh',
  'route.deviation_km',
  'geofence.inside',
  'event.type',
  'device_id',
  'battery.level',
  'signal.rssi',
  'idle.seconds',
  'cargo.value',
  'convoy.status',
];
const operators = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'contains', 'exists', 'in', 'between'];
const actionTypes = ['alert', 'create_incident', 'notify', 'webhook', 'escalate', 'tag', 'log'];
const patterns = [
  { name: 'Overspeed containment', severity: 'critical', field: 'speed_kmh', operator: 'gt', value: 110 },
  { name: 'Corridor deviation', severity: 'high', field: 'route.deviation_km', operator: 'gt', value: 2 },
  { name: 'Telemetry silence', severity: 'high', field: 'event.type', operator: 'eq', value: 'device.offline' },
  { name: 'Geofence breach', severity: 'critical', field: 'geofence.inside', operator: 'eq', value: false },
  { name: 'Low battery guard', severity: 'medium', field: 'battery.level', operator: 'lt', value: 25 },
  { name: 'Critical cargo movement', severity: 'high', field: 'cargo.value', operator: 'gt', value: 100000 },
];

function severityClass(value = 'medium') {
  if (value === 'critical') return 'border-red-400/20 bg-red-400/10 text-red-300';
  if (value === 'high') return 'border-orange-400/20 bg-orange-400/10 text-orange-300';
  if (value === 'low') return 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300';
  return 'border-amber-300/20 bg-amber-300/10 text-amber-200';
}

function formatCount(value: number) {
  return value.toLocaleString();
}

function conditionLabel(condition: Condition) {
  const value = Array.isArray(condition.value) ? condition.value.join(', ') : String(condition.value ?? '');
  return `${condition.field} ${condition.operator}${value ? ` ${value}` : ''}`;
}

function actionLabel(action: Action) {
  const base = action.type.replaceAll('_', ' ');
  return action.channel ? `${base} · ${action.channel}` : base;
}

function SectionTitle({ step, title, detail }: { step: string; title: string; detail: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="font-mono text-[10px] text-orange-300">{step}</span>
      <div>
        <div className="text-xs font-semibold text-slate-200">{title}</div>
        <div className="mt-0.5 text-[10px] leading-4 text-slate-600">{detail}</div>
      </div>
    </div>
  );
}

function PolicyStudio({
  initial,
  onClose,
  onSaved,
}: {
  initial: Rule | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [priority, setPriority] = useState(String(initial?.priority ?? 500));
  const [severity, setSeverity] = useState(initial?.severity ?? 'medium');
  const [mode, setMode] = useState(initial?.mode ?? 'live');
  const [logic, setLogic] = useState<'all' | 'any'>(initial?.condition_logic ?? 'all');
  const [cooldown, setCooldown] = useState(String(initial?.cooldown_seconds ?? 900));
  const [conditions, setConditions] = useState<Condition[]>(
    initial?.conditions?.length ? initial.conditions : [{ field: 'speed_kmh', operator: 'gt', value: 110 }],
  );
  const [actions, setActions] = useState<Action[]>(
    initial?.actions?.length ? initial.actions : [{ type: 'alert', severity: 'high' }],
  );
  const [tags, setTags] = useState((initial?.tags ?? []).join(', '));
  const [scope, setScope] = useState(JSON.stringify(initial?.scope ?? { type: 'organisation' }, null, 2));
  const [schedule, setSchedule] = useState('Always on');

  const save = useMutation({
    mutationFn: async () => {
      if (!name.trim()) throw new Error('Policy name is required');
      let scopeValue: Record<string, unknown>;
      try {
        scopeValue = JSON.parse(scope) as Record<string, unknown>;
      } catch {
        throw new Error('Scope must be valid JSON');
      }
      const payload = {
        name: name.trim(),
        description: description.trim(),
        enabled: true,
        status: 'active',
        priority: Number(priority) || 0,
        severity,
        mode,
        version: (initial?.version ?? 0) + 1,
        scope: scopeValue,
        conditions,
        condition_logic: logic,
        actions,
        cooldown_seconds: Number(cooldown) || 0,
        evaluation_window_seconds: 0,
        deduplication: { strategy: 'rule_subject', ttl_seconds: Number(cooldown) || 900 },
        schedule,
        tags: tags
          .split(',')
          .map((tag) => tag.trim())
          .filter(Boolean),
      };
      return initial ? rulesAPI.update(initial.id, payload) : rulesAPI.create(payload);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['rules'] });
      void queryClient.invalidateQueries({ queryKey: ['rules-stats'] });
      onSaved();
    },
  });

  const updateCondition = (index: number, patch: Partial<Condition>) => {
    setConditions((items) => items.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)));
  };
  const updateAction = (index: number, patch: Partial<Action>) => {
    setActions((items) => items.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)));
  };

  return (
    <div className="fixed inset-0 z-[80] bg-black/75">
      <aside className="absolute inset-y-0 right-0 w-full max-w-[900px] overflow-y-auto border-l border-white/10 bg-[#050d11] shadow-[0_0_100px_rgba(0,0,0,.7)]">
        <header className="sticky top-0 z-10 border-b border-white/[0.07] bg-[#071014]/95 backdrop-blur-xl">
          <div className="flex items-center justify-between gap-5 px-6 py-5">
            <div>
              <div className="text-[9px] uppercase tracking-[0.26em] text-orange-300">Policy studio</div>
              <h2 className="mt-1 text-xl font-semibold">{initial ? 'Revise policy' : 'Compose policy'}</h2>
              <div className="mt-1 text-[10px] text-slate-600">Build a deterministic rule, inspect its release posture, then publish.</div>
            </div>
            <button type="button" onClick={onClose} className="p-2 text-slate-500 hover:text-white" aria-label="Close policy studio">
              <X size={18} />
            </button>
          </div>
          <div className="grid grid-cols-5 border-t border-white/[0.05] text-[8px] uppercase tracking-[0.17em] text-slate-600">
            {['Intent', 'Trigger graph', 'Guards', 'Response graph', 'Release'].map((item, index) => (
              <div key={item} className={`border-r border-white/[0.05] px-4 py-2 ${index === 0 ? 'text-orange-300' : ''}`}>
                0{index + 1} {item}
              </div>
            ))}
          </div>
        </header>

        <div className="space-y-5 p-6">
          <section className={`${card} p-5`}>
            <SectionTitle step="01" title="Operational intent" detail="Define the failure mode and the containment objective." />
            <div className="mt-4 grid gap-3">
              <input className={input} value={name} onChange={(event) => setName(event.target.value)} placeholder="Policy name" />
              <textarea
                className={`${input} min-h-24 resize-none`}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Describe the event, consequence and operational objective…"
              />
              <div className="grid gap-3 md:grid-cols-3">
                <label className="text-[9px] uppercase tracking-widest text-slate-600">
                  Severity
                  <select className={`${input} mt-1`} value={severity} onChange={(event) => setSeverity(event.target.value)}>
                    {['low', 'medium', 'high', 'critical'].map((value) => <option key={value}>{value}</option>)}
                  </select>
                </label>
                <label className="text-[9px] uppercase tracking-widest text-slate-600">
                  Priority
                  <input className={`${input} mt-1`} value={priority} onChange={(event) => setPriority(event.target.value)} inputMode="numeric" />
                </label>
                <label className="text-[9px] uppercase tracking-widest text-slate-600">
                  Execution mode
                  <select className={`${input} mt-1`} value={mode} onChange={(event) => setMode(event.target.value)}>
                    <option value="live">Live</option>
                    <option value="dry_run">Dry run</option>
                  </select>
                </label>
              </div>
            </div>
          </section>

          <section className={`${card} p-5`}>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <SectionTitle step="02" title="Trigger graph" detail="Evaluate predicates against the event envelope in a deterministic order." />
              <select className="border border-white/[0.08] bg-[#050d11] px-3 py-2 text-[9px] uppercase tracking-widest text-slate-400" value={logic} onChange={(event) => setLogic(event.target.value as 'all' | 'any')}>
                <option value="all">ALL predicates</option>
                <option value="any">ANY predicate</option>
              </select>
            </div>
            <div className="mt-4 space-y-2">
              {conditions.map((condition, index) => (
                <div key={`${index}-${condition.field}`} className="grid gap-2 border border-cyan-400/10 bg-cyan-400/[0.025] p-2 md:grid-cols-[1.15fr_.75fr_1fr_36px]">
                  <select className={input} value={condition.field} onChange={(event) => updateCondition(index, { field: event.target.value })}>
                    {fields.map((field) => <option key={field}>{field}</option>)}
                  </select>
                  <select className={input} value={condition.operator} onChange={(event) => updateCondition(index, { operator: event.target.value })}>
                    {operators.map((operator) => <option key={operator}>{operator}</option>)}
                  </select>
                  <input
                    className={input}
                    value={Array.isArray(condition.value) ? condition.value.join(',') : String(condition.value ?? '')}
                    onChange={(event) => updateCondition(index, { value: event.target.value })}
                    placeholder="Value"
                  />
                  <button
                    type="button"
                    disabled={conditions.length === 1}
                    onClick={() => setConditions((items) => items.filter((_, itemIndex) => itemIndex !== index))}
                    className="flex items-center justify-center border border-white/[0.06] text-slate-600 hover:text-red-300 disabled:opacity-30"
                    aria-label="Remove predicate"
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
            <button type="button" onClick={() => setConditions((items) => [...items, { field: 'event.type', operator: 'eq', value: '' }])} className="mt-3 text-[9px] uppercase tracking-widest text-cyan-300 hover:text-cyan-200">
              + Add predicate
            </button>
          </section>

          <section className={`${card} p-5`}>
            <SectionTitle step="03" title="Safety & runtime guards" detail="Prevent uncontrolled repetition, scope bleed and unsafe execution pressure." />
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <label className="text-[9px] uppercase tracking-widest text-slate-600">
                Cooldown seconds
                <input className={`${input} mt-1`} value={cooldown} onChange={(event) => setCooldown(event.target.value)} inputMode="numeric" />
              </label>
              <label className="text-[9px] uppercase tracking-widest text-slate-600">
                Schedule window
                <select className={`${input} mt-1`} value={schedule} onChange={(event) => setSchedule(event.target.value)}>
                  <option>Always on</option>
                  <option>Business hours</option>
                  <option>Night operations</option>
                  <option>Custom schedule</option>
                </select>
              </label>
              <label className="text-[9px] uppercase tracking-widest text-slate-600 md:col-span-2">
                Scope JSON
                <textarea className={`${input} mt-1 min-h-24 resize-y font-mono text-[10px]`} value={scope} onChange={(event) => setScope(event.target.value)} />
              </label>
              <label className="text-[9px] uppercase tracking-widest text-slate-600 md:col-span-2">
                Tags
                <input className={`${input} mt-1`} value={tags} onChange={(event) => setTags(event.target.value)} placeholder="security, route, fleet" />
              </label>
            </div>
          </section>

          <section className={`${card} p-5`}>
            <SectionTitle step="04" title="Response graph" detail="Define the side effects emitted after a match, in operator-visible order." />
            <div className="mt-4 space-y-2">
              {actions.map((action, index) => (
                <div key={`${index}-${action.type}`} className="grid gap-2 border border-emerald-400/10 bg-emerald-400/[0.025] p-2 md:grid-cols-[1fr_1fr_1fr_36px]">
                  <select className={input} value={action.type} onChange={(event) => updateAction(index, { type: event.target.value })}>
                    {actionTypes.map((type) => <option key={type}>{type}</option>)}
                  </select>
                  <select className={input} value={action.channel ?? ''} onChange={(event) => updateAction(index, { channel: event.target.value || undefined })}>
                    <option value="">No channel</option>
                    <option value="in_app">In-app</option>
                    <option value="email">Email</option>
                    <option value="whatsapp">WhatsApp</option>
                    <option value="webhook">Webhook</option>
                  </select>
                  <input className={input} value={action.recipient ?? ''} onChange={(event) => updateAction(index, { recipient: event.target.value || undefined })} placeholder="Recipient / queue" />
                  <button type="button" disabled={actions.length === 1} onClick={() => setActions((items) => items.filter((_, itemIndex) => itemIndex !== index))} className="flex items-center justify-center border border-white/[0.06] text-slate-600 hover:text-red-300 disabled:opacity-30" aria-label="Remove response">
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
            <button type="button" onClick={() => setActions((items) => [...items, { type: 'notify', channel: 'in_app' }])} className="mt-3 text-[9px] uppercase tracking-widest text-emerald-300 hover:text-emerald-200">
              + Add response
            </button>
          </section>

          <section className={`${card} p-5`}>
            <SectionTitle step="05" title="Release gate" detail="Inspect the exact policy path before activating the new version." />
            <div className="mt-4 border border-white/[0.06] bg-black/20 p-4 font-mono text-[10px] leading-5 text-slate-400">
              <div className="text-orange-300">WHEN</div>
              {conditions.map((condition, index) => <div key={`when-${index}`}>{index ? '  AND ' : '  '}{conditionLabel(condition)}</div>)}
              <div className="mt-2 text-emerald-300">THEN</div>
              {actions.map((action, index) => <div key={`then-${index}`}>  {index + 1}. {actionLabel(action)}</div>)}
              <div className="mt-2 text-violet-300">GUARDS</div>
              <div>  cooldown={Number(cooldown) || 0}s · schedule={schedule} · mode={mode}</div>
              <div>  scope={scope.trim() ? 'configured' : 'missing'}</div>
            </div>
            {save.isError && <div className="mt-3 border border-red-400/15 bg-red-400/[0.04] px-3 py-2 text-[10px] text-red-300">{save.error instanceof Error ? save.error.message : 'Unable to publish policy.'}</div>}
            <div className="mt-4 flex gap-2">
              <button type="button" onClick={onClose} className="flex-1 border border-white/[0.08] py-3 text-xs text-slate-400 hover:text-white">Cancel</button>
              <button type="button" disabled={save.isPending || !name.trim()} onClick={() => save.mutate()} className="flex-[2] bg-orange-500 py-3 text-xs font-bold text-slate-950 disabled:opacity-40">
                {save.isPending ? 'Publishing…' : initial ? 'Publish new version' : 'Deploy policy'}
              </button>
            </div>
          </section>
        </div>
      </aside>
    </div>
  );
}

function PolicyInspector({ rule, onClose, onEdit }: { rule: Rule; onClose: () => void; onEdit: () => void }) {
  const [tab, setTab] = useState<'overview' | 'simulation' | 'trace'>('overview');
  const [payload, setPayload] = useState('{\n  "speed_kmh": 120,\n  "route": { "deviation_km": 3 },\n  "device_id": "TRK-001"\n}');
  const executionsQuery = useQuery({
    queryKey: ['rule-executions', rule.id],
    queryFn: async () => ((await rulesAPI.executions(rule.id, 40)).data?.data ?? []) as Execution[],
  });
  const simulation = useMutation({
    mutationFn: async () => {
      let event: unknown;
      try {
        event = JSON.parse(payload);
      } catch {
        throw new Error('Simulation payload is not valid JSON');
      }
      return rulesAPI.test(rule.id, event);
    },
  });

  return (
    <div className="fixed inset-0 z-[70] bg-black/60">
      <aside className="absolute inset-y-0 right-0 w-full max-w-[760px] overflow-y-auto border-l border-white/10 bg-[#050d11] shadow-2xl">
        <header className="sticky top-0 z-10 border-b border-white/[0.07] bg-[#071014]/95 px-6 py-5 backdrop-blur-xl">
          <div className="flex items-start justify-between gap-5">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className={`border px-2 py-1 text-[8px] uppercase tracking-widest ${severityClass(rule.severity)}`}>{rule.severity ?? 'medium'}</span>
                <span className="font-mono text-[9px] text-slate-600">v{rule.version ?? 1}</span>
                <span className="text-[9px] uppercase tracking-widest text-slate-600">{rule.mode ?? 'live'}</span>
              </div>
              <h2 className="mt-2 text-xl font-semibold">{rule.name}</h2>
              <p className="mt-1 max-w-xl text-xs leading-5 text-slate-500">{rule.description || 'No description recorded.'}</p>
            </div>
            <button type="button" onClick={onClose} className="p-2 text-slate-500 hover:text-white" aria-label="Close inspector"><X size={18} /></button>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2">
            <div className="border border-white/[0.06] p-3"><div className="text-[8px] uppercase tracking-widest text-slate-600">State</div><div className="mt-1 text-xs">{rule.status ?? (rule.enabled ? 'active' : 'paused')}</div></div>
            <div className="border border-white/[0.06] p-3"><div className="text-[8px] uppercase tracking-widest text-slate-600">Priority</div><div className="mt-1 text-xs">{rule.priority ?? 0}</div></div>
            <div className="border border-white/[0.06] p-3"><div className="text-[8px] uppercase tracking-widest text-slate-600">Runs</div><div className="mt-1 text-xs">{formatCount(Number(rule.trigger_count ?? 0))}</div></div>
          </div>
          <div className="mt-4 flex border-b border-white/[0.05]">
            {[['overview', 'Policy'], ['simulation', 'Simulation'], ['trace', 'Execution trace']].map(([value, label]) => (
              <button key={value} type="button" onClick={() => setTab(value as 'overview' | 'simulation' | 'trace')} className={`border-b-2 px-4 py-2 text-[9px] uppercase tracking-widest ${tab === value ? 'border-orange-400 text-orange-300' : 'border-transparent text-slate-600 hover:text-slate-300'}`}>{label}</button>
            ))}
          </div>
        </header>
        <div className="space-y-5 p-6">
          {tab === 'overview' && (
            <>
              <section className={card + ' p-5'}>
                <div className="flex items-center gap-2 text-[9px] uppercase tracking-widest text-slate-600"><Shield size={12} className="text-cyan-300" /> Trigger topology</div>
                <div className="mt-4 grid gap-2">
                  {(rule.conditions ?? []).map((condition, index) => <div key={index} className="flex items-center gap-3 border border-cyan-400/10 bg-cyan-400/[0.025] p-3"><span className="font-mono text-[9px] text-cyan-300">C{index + 1}</span><span className="text-xs">{conditionLabel(condition)}</span></div>)}
                </div>
              </section>
              <section className={card + ' p-5'}>
                <div className="flex items-center gap-2 text-[9px] uppercase tracking-widest text-slate-600"><Zap size={12} className="text-emerald-300" /> Response topology</div>
                <div className="mt-4 grid gap-2">
                  {(rule.actions ?? []).map((action, index) => <div key={index} className="flex items-center gap-3 border border-emerald-400/10 bg-emerald-400/[0.025] p-3"><span className="font-mono text-[9px] text-emerald-300">A{index + 1}</span><span className="text-xs">{actionLabel(action)}</span></div>)}
                </div>
              </section>
              <section className={card + ' p-5'}>
                <div className="grid grid-cols-2 gap-2">
                  <div className="border border-white/[0.06] p-3"><div className="text-[8px] uppercase tracking-widest text-slate-600">Cooldown</div><div className="mt-1 text-xs">{rule.cooldown_seconds ?? 0}s</div></div>
                  <div className="border border-white/[0.06] p-3"><div className="text-[8px] uppercase tracking-widest text-slate-600">Scope</div><div className="mt-1 break-words text-[10px] text-slate-400">{JSON.stringify(rule.scope ?? { type: 'organisation' })}</div></div>
                  <div className="border border-white/[0.06] p-3"><div className="text-[8px] uppercase tracking-widest text-slate-600">Last triggered</div><div className="mt-1 text-[10px] text-slate-400">{rule.last_triggered_at ? new Date(rule.last_triggered_at).toLocaleString() : 'Never'}</div></div>
                  <div className="border border-white/[0.06] p-3"><div className="text-[8px] uppercase tracking-widest text-slate-600">Failures</div><div className="mt-1 text-xs">{formatCount(Number(rule.failure_count ?? 0))}</div></div>
                </div>
              </section>
              <div className="flex gap-2">
                <button type="button" onClick={onEdit} className="flex-1 bg-orange-500 py-3 text-xs font-bold text-slate-950">Edit policy</button>
                <button type="button" onClick={() => setTab('simulation')} className="border border-white/[0.08] px-5 text-xs text-slate-300 hover:text-white">Simulate</button>
              </div>
            </>
          )}
          {tab === 'simulation' && (
            <section className={card + ' p-5'}>
              <div className="flex items-center gap-2 text-xs font-semibold"><Sparkles size={14} className="text-violet-300" /> Dry-run event simulator</div>
              <p className="mt-2 text-[10px] leading-5 text-slate-600">Exercise the current policy against an event payload without emitting production side effects.</p>
              <textarea className={`${input} mt-4 min-h-56 font-mono text-[10px] leading-5`} value={payload} onChange={(event) => setPayload(event.target.value)} />
              <button type="button" onClick={() => simulation.mutate()} disabled={simulation.isPending} className="mt-3 w-full bg-violet-500 py-3 text-xs font-bold text-slate-950 disabled:opacity-40">{simulation.isPending ? 'Evaluating…' : 'Evaluate event'}</button>
              {simulation.isError && <div className="mt-3 border border-red-400/15 bg-red-400/[0.04] px-3 py-2 text-[10px] text-red-300">{simulation.error instanceof Error ? simulation.error.message : 'Evaluation failed.'}</div>}
              {simulation.data && <pre className="mt-3 max-h-80 overflow-auto border border-white/[0.06] bg-black/30 p-4 text-[10px] leading-5 text-slate-400">{JSON.stringify(simulation.data.data?.data ?? simulation.data.data, null, 2)}</pre>}
            </section>
          )}
          {tab === 'trace' && (
            <section className={card + ' overflow-hidden'}>
              <div className="border-b border-white/[0.06] px-5 py-4"><div className="flex items-center gap-2 text-xs font-semibold"><History size={13} className="text-orange-300" /> Recent evaluations</div></div>
              {executionsQuery.isLoading && <div className="p-10 text-center text-xs text-slate-600">Loading execution trace…</div>}
              {!executionsQuery.isLoading && (executionsQuery.data ?? []).map((execution) => (
                <div key={execution.id} className="border-b border-white/[0.05] p-4">
                  <div className="flex items-center justify-between gap-4"><div className="text-xs text-slate-200">{execution.event_type}</div><div className="text-[9px] text-slate-600">{new Date(execution.evaluated_at).toLocaleString()}</div></div>
                  <div className="mt-2 flex flex-wrap gap-2"><span className={`px-2 py-1 text-[8px] uppercase tracking-widest ${execution.matched ? 'bg-emerald-400/10 text-emerald-300' : 'bg-white/[0.03] text-slate-600'}`}>{execution.matched ? 'matched' : 'no match'}</span>{execution.suppressed && <span className="bg-amber-400/10 px-2 py-1 text-[8px] uppercase tracking-widest text-amber-300">suppressed</span>}<span className="text-[9px] text-slate-600">{execution.decision_ms ?? '—'} ms</span></div>
                  {execution.suppression_reason && <div className="mt-2 text-[10px] text-amber-300">{execution.suppression_reason}</div>}
                  {execution.condition_trace?.length ? <div className="mt-3 space-y-1">{execution.condition_trace.map((item, index) => <div key={index} className="flex items-center gap-2 text-[9px]"><Check size={11} className={item.matched ? 'text-emerald-300' : 'text-red-300'} /><span className="text-slate-500">{item.field} {item.operator}</span><span className="text-slate-700">expected {String(item.expected ?? '')}</span><span className="text-slate-600">actual {String(item.actual ?? '')}</span></div>)}</div> : null}
                </div>
              ))}
              {!executionsQuery.isLoading && !(executionsQuery.data ?? []).length && <div className="p-10 text-center text-xs text-slate-600">No execution records for this policy.</div>}
            </section>
          )}
        </div>
      </aside>
    </div>
  );
}

export default function RulesOperationsConsole() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>('registry');
  const [query, setQuery] = useState('');
  const [severityFilter, setSeverityFilter] = useState('all');
  const [stateFilter, setStateFilter] = useState('all');
  const [studio, setStudio] = useState<{ open: boolean; rule: Rule | null }>({ open: false, rule: null });
  const [selected, setSelected] = useState<Rule | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const rulesQuery = useQuery({
    queryKey: ['rules'],
    queryFn: async () => ((await rulesAPI.list()).data?.data ?? []) as Rule[],
  });
  const statsQuery = useQuery({
    queryKey: ['rules-stats'],
    queryFn: async () => ((await rulesAPI.stats()).data?.data ?? {}) as Record<string, unknown>,
  });
  const executionsQuery = useQuery({
    queryKey: ['rules-recent-executions'],
    enabled: tab === 'executions',
    queryFn: async () => {
      const rules = (rulesQuery.data ?? []).slice(0, 8);
      const responses = await Promise.allSettled(rules.map((rule) => rulesAPI.executions(rule.id, 10)));
      return responses.flatMap((response, index) => {
        if (response.status !== 'fulfilled') return [];
        const data = (response.value.data?.data ?? []) as Execution[];
        return data.map((execution) => ({ ...execution, rule_name: rules[index]?.name ?? 'Unknown policy' }));
      }).sort((a, b) => new Date(b.evaluated_at).getTime() - new Date(a.evaluated_at).getTime());
    },
  });

  const toggle = useMutation({
    mutationFn: (rule: Rule) => rulesAPI.toggle(rule.id, !rule.enabled),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['rules'] });
      void queryClient.invalidateQueries({ queryKey: ['rules-stats'] });
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => rulesAPI.remove(id),
    onSuccess: () => {
      setSelected(null);
      void queryClient.invalidateQueries({ queryKey: ['rules'] });
      void queryClient.invalidateQueries({ queryKey: ['rules-stats'] });
    },
  });

  const rules = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return (rulesQuery.data ?? []).filter((rule) => {
      const haystack = `${rule.name} ${rule.description ?? ''} ${(rule.tags ?? []).join(' ')}`.toLowerCase();
      const state = rule.status ?? (rule.enabled ? 'active' : 'paused');
      return (!normalized || haystack.includes(normalized)) &&
        (severityFilter === 'all' || (rule.severity ?? 'medium') === severityFilter) &&
        (stateFilter === 'all' || state === stateFilter);
    });
  }, [rulesQuery.data, query, severityFilter, stateFilter]);

  const stats = {
    total: Number(statsQuery.data?.total ?? rulesQuery.data?.length ?? 0),
    active: Number(statsQuery.data?.active ?? (rulesQuery.data ?? []).filter((rule) => rule.enabled).length),
    executions: Number(statsQuery.data?.executions ?? 0),
    failures: Number(statsQuery.data?.failures ?? 0),
  };

  const refresh = () => {
    void rulesQuery.refetch();
    void statsQuery.refetch();
    if (tab === 'executions') void executionsQuery.refetch();
  };

  return (
    <div className="min-h-full bg-[#050b0f] text-slate-100">
      <header className="border-b border-white/[0.07] bg-[#071014]">
        <div className="mx-auto max-w-[1900px] px-6 py-5">
          <div className="flex flex-wrap items-end justify-between gap-5">
            <div>
              <div className="flex items-center gap-2 text-[9px] uppercase tracking-[0.28em] text-orange-300"><span className="h-1.5 w-1.5 bg-orange-400 shadow-[0_0_12px_rgba(251,146,60,.7)]" /> Automation operations</div>
              <h1 className="mt-2 text-2xl font-semibold tracking-tight">Rules Control Plane</h1>
              <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-500">Deterministic policy orchestration with simulation, execution evidence, version context and runtime controls.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-2 border border-emerald-400/15 bg-emerald-400/[0.03] px-3 py-2 text-[9px] uppercase tracking-widest text-emerald-300"><span className="h-1.5 w-1.5 bg-emerald-400" /> Runtime online</div>
              <button type="button" onClick={refresh} className="border border-white/[0.08] p-2.5 text-slate-500 hover:text-white" aria-label="Refresh rules"><RefreshCw size={14} /></button>
              <button type="button" onClick={() => setStudio({ open: true, rule: null })} className="flex items-center gap-2 bg-orange-500 px-4 py-2.5 text-xs font-bold text-slate-950"><Plus size={14} /> Compose policy</button>
            </div>
          </div>
          <div className="mt-5 grid grid-cols-2 divide-x divide-white/[0.06] border border-white/[0.06] bg-[#081217] md:grid-cols-4">
            {[
              ['Policies', stats.total, 'organisation registry', Layers3],
              ['Active', stats.active, `${stats.total ? Math.round((stats.active / stats.total) * 100) : 0}% of policies`, CirclePlay],
              ['Executions', formatCount(stats.executions), 'evaluations recorded', Activity],
              ['Failures', formatCount(stats.failures), 'runtime & action errors', AlertTriangle],
            ].map(([label, value, detail, Icon]) => (
              <div key={String(label)} className="px-4 py-4"><div className="flex items-center justify-between text-[8px] uppercase tracking-[0.18em] text-slate-600"><span>{label}</span><Icon size={13} /></div><div className="mt-1 text-2xl font-semibold tabular-nums">{value as string | number}</div><div className="mt-1 text-[10px] text-slate-600">{detail as string}</div></div>
            ))}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1900px] px-6 pb-12">
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.07]">
          <div className="flex overflow-x-auto">
            {[['registry', 'Policy registry', Layers3], ['executions', 'Execution ledger', History], ['patterns', 'Pattern library', Copy]].map(([value, label, Icon]) => (
              <button key={String(value)} type="button" onClick={() => setTab(value as Tab)} className={`flex items-center gap-2 border-b-2 px-4 py-3 text-[9px] uppercase tracking-widest ${tab === value ? 'border-orange-400 text-orange-300' : 'border-transparent text-slate-600 hover:text-slate-300'}`}><Icon size={13} />{label}</button>
            ))}
          </div>
          <div className="hidden items-center gap-2 text-[8px] uppercase tracking-widest text-slate-700 lg:flex"><Clock3 size={11} /> Operator view · live</div>
        </div>

        {tab === 'registry' && (
          <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_310px]">
            <section className={card + ' overflow-hidden'}>
              <div className="grid gap-2 border-b border-white/[0.06] p-4 md:grid-cols-[minmax(0,1fr)_150px_150px]">
                <div className="relative"><Search size={13} className="absolute left-3 top-3 text-slate-600" /><input className={`${input} pl-9`} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search intent, policy or tags…" /></div>
                <select className="border border-white/[0.08] bg-[#071014] px-3 text-[9px] uppercase tracking-widest text-slate-400" value={severityFilter} onChange={(event) => setSeverityFilter(event.target.value)}><option value="all">All severities</option>{['critical', 'high', 'medium', 'low'].map((value) => <option key={value}>{value}</option>)}</select>
                <select className="border border-white/[0.08] bg-[#071014] px-3 text-[9px] uppercase tracking-widest text-slate-400" value={stateFilter} onChange={(event) => setStateFilter(event.target.value)}><option value="all">All states</option><option value="active">active</option><option value="paused">paused</option><option value="error">error</option></select>
              </div>
              <div className="hidden grid-cols-[1.5fr_1.15fr_1.05fr_120px_90px] gap-4 border-b border-white/[0.06] px-5 py-3 text-[8px] uppercase tracking-[0.18em] text-slate-600 md:grid"><span>Policy</span><span>Trigger topology</span><span>Response topology</span><span>Runtime</span><span /></div>
              {rulesQuery.isLoading && <div className="p-16 text-center text-xs text-slate-600">Loading policy fabric…</div>}
              {!rulesQuery.isLoading && !rules.length && <div className="p-16 text-center"><Filter size={18} className="mx-auto text-slate-700" /><div className="mt-3 text-xs text-slate-500">No policies match this view.</div><button type="button" onClick={() => { setQuery(''); setSeverityFilter('all'); setStateFilter('all'); }} className="mt-3 text-[9px] uppercase tracking-widest text-orange-300">Clear filters</button></div>}
              {rules.map((rule) => {
                const isExpanded = expanded === rule.id;
                return (
                  <div key={rule.id} className="border-b border-white/[0.045]">
                    <button type="button" onClick={() => setSelected(rule)} className="block w-full text-left hover:bg-white/[0.02]">
                      <div className="grid gap-4 px-5 py-4 md:grid-cols-[1.5fr_1.15fr_1.05fr_120px_90px]">
                        <div className="min-w-0"><div className="flex items-center gap-2"><span className={`h-2 w-2 ${rule.enabled ? 'bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,.55)]' : 'bg-slate-700'}`} /><span className="truncate text-xs font-semibold">{rule.name}</span><span className={`border px-1.5 py-0.5 text-[7px] uppercase ${severityClass(rule.severity)}`}>{rule.severity ?? 'medium'}</span><span className="font-mono text-[8px] text-slate-700">v{rule.version ?? 1}</span></div><div className="mt-1 truncate pl-4 text-[10px] text-slate-600">{rule.description || 'No description'}{rule.tags?.length ? ` · ${rule.tags.join(' · ')}` : ''}</div></div>
                        <div className="min-w-0"><div className="text-[10px] text-cyan-300">{String(rule.condition_logic ?? 'all').toUpperCase()} · {rule.conditions?.length ?? 0} predicates</div><div className="mt-1 truncate text-[9px] text-slate-600">{(rule.conditions ?? []).slice(0, 2).map(conditionLabel).join(' / ')}</div></div>
                        <div className="min-w-0"><div className="truncate text-[10px] text-emerald-200">{(rule.actions ?? []).map(actionLabel).join(' + ') || 'No side effects'}</div><div className="mt-1 text-[9px] text-slate-600">cooldown {rule.cooldown_seconds ?? 0}s</div></div>
                        <div><div className="text-[10px] text-slate-300">{formatCount(Number(rule.trigger_count ?? 0))} runs</div><div className="mt-1 text-[9px] text-slate-600">{formatCount(Number(rule.failure_count ?? 0))} failed</div></div>
                        <div className="flex items-center justify-end gap-1"><button type="button" onClick={(event) => { event.stopPropagation(); toggle.mutate(rule); }} className="border border-white/[0.06] p-2 text-slate-500 hover:text-white" aria-label={rule.enabled ? 'Pause policy' : 'Enable policy'}>{rule.enabled ? <CirclePause size={14} /> : <CirclePlay size={14} />}</button><ChevronRight size={14} className="text-slate-700" /></div>
                      </div>
                    </button>
                    <div className="flex items-center gap-4 px-5 pb-3 pl-9"><button type="button" onClick={() => setExpanded(isExpanded ? null : rule.id)} className="flex items-center gap-1 text-[8px] uppercase tracking-widest text-slate-700 hover:text-slate-300">{isExpanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />} Quick inspect</button>{isExpanded && <><span className="text-[8px] text-slate-700">Last: {rule.last_triggered_at ? new Date(rule.last_triggered_at).toLocaleString() : 'never'}</span><button type="button" onClick={() => setStudio({ open: true, rule })} className="text-[8px] uppercase tracking-widest text-orange-300">Edit</button><button type="button" onClick={() => setTab('executions')} className="text-[8px] uppercase tracking-widest text-cyan-300">Trace</button><button type="button" onClick={() => remove.mutate(rule.id)} disabled={remove.isPending} className="ml-auto flex items-center gap-1 text-[8px] uppercase tracking-widest text-red-300/70 hover:text-red-300"><Trash2 size={11} /> Remove</button></>}</div>
                  </div>
                );
              })}
            </section>
            <aside className="space-y-4">
              <section className={card + ' p-5'}><div className="flex items-center gap-2 text-xs font-semibold"><SlidersHorizontal size={13} className="text-orange-300" /> Runtime posture</div><div className="mt-4 space-y-3 text-[10px]"><div className="flex justify-between"><span className="text-slate-600">Active policies</span><span>{stats.active}/{stats.total}</span></div><div className="h-1 bg-white/[0.04]"><div className="h-full bg-emerald-400/70" style={{ width: `${stats.total ? Math.min(100, (stats.active / stats.total) * 100) : 0}%` }} /></div><div className="flex justify-between"><span className="text-slate-600">Failure rate</span><span>{stats.executions ? ((stats.failures / stats.executions) * 100).toFixed(1) : '0.0'}%</span></div><div className="flex justify-between"><span className="text-slate-600">Execution surface</span><span>deterministic</span></div></div></section>
              <section className={card + ' p-5'}><div className="flex items-center gap-2 text-xs font-semibold"><Shield size={13} className="text-cyan-300" /> Control principles</div><div className="mt-3 space-y-2 text-[10px] leading-5 text-slate-500"><div>Predicate evaluation is inspectable.</div><div>Scope stays organisation-bound.</div><div>Simulation is isolated from side effects.</div><div>Execution evidence remains queryable.</div></div></section>
              <section className={card + ' p-5'}><div className="text-[8px] uppercase tracking-widest text-slate-600">Selected view</div><div className="mt-2 text-sm font-semibold">{rules.length} visible policies</div><div className="mt-1 text-[10px] text-slate-600">Filters persist while you inspect or edit.</div></section>
            </aside>
          </div>
        )}

        {tab === 'executions' && (
          <section className={`${card} mt-4 overflow-hidden`}>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.06] px-5 py-4"><div><div className="flex items-center gap-2 text-xs font-semibold"><History size={13} className="text-orange-300" /> Execution ledger</div><div className="mt-1 text-[10px] text-slate-600">Recent evaluations across the visible policy set.</div></div><button type="button" onClick={() => void executionsQuery.refetch()} className="border border-white/[0.08] p-2 text-slate-500 hover:text-white" aria-label="Refresh execution ledger"><RefreshCw size={13} /></button></div>
            {executionsQuery.isLoading && <div className="p-16 text-center text-xs text-slate-600">Collecting execution evidence…</div>}
            {!executionsQuery.isLoading && !(executionsQuery.data ?? []).length && <div className="p-16 text-center text-xs text-slate-600">No execution records found for the available policies.</div>}
            {(executionsQuery.data ?? []).map((execution) => (
              <div key={`${execution.id}-${execution.evaluated_at}`} className="grid gap-3 border-b border-white/[0.045] px-5 py-4 lg:grid-cols-[1.5fr_1fr_150px_120px_1fr] lg:items-center"><div><div className="text-xs text-slate-200">{execution.rule_name}</div><div className="mt-1 font-mono text-[9px] text-slate-700">{execution.event_type}{execution.subject_id ? ` · ${execution.subject_id}` : ''}</div></div><div className="flex flex-wrap gap-2"><span className={`px-2 py-1 text-[8px] uppercase tracking-widest ${execution.matched ? 'bg-emerald-400/10 text-emerald-300' : 'bg-white/[0.03] text-slate-600'}`}>{execution.matched ? 'matched' : 'no match'}</span>{execution.suppressed && <span className="bg-amber-400/10 px-2 py-1 text-[8px] text-amber-300">suppressed</span>}</div><div className="text-[10px] text-slate-600">{execution.decision_ms ?? '—'} ms</div><div className="text-[9px] text-slate-600">{new Date(execution.evaluated_at).toLocaleString()}</div><div className="text-right"><button type="button" onClick={() => { const rule = (rulesQuery.data ?? []).find((item) => item.name === execution.rule_name); if (rule) setSelected(rule); }} className="inline-flex items-center gap-1 text-[8px] uppercase tracking-widest text-cyan-300 hover:text-cyan-200">Inspect <ExternalLink size={10} /></button></div></div>
            ))}
          </section>
        )}

        {tab === 'patterns' && (
          <section className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {patterns.map((pattern) => (
              <button key={pattern.name} type="button" onClick={() => setStudio({ open: true, rule: { id: '', name: pattern.name, description: `Pattern starter for ${pattern.name.toLowerCase()}.`, enabled: true, severity: pattern.severity, mode: 'live', priority: 500, version: 1, conditions: [{ field: pattern.field, operator: pattern.operator, value: pattern.value }], condition_logic: 'all', actions: [{ type: 'alert', severity: pattern.severity }], cooldown_seconds: 900, scope: { type: 'organisation' }, tags: ['pattern'] } })} className={`${card} p-5 text-left transition hover:-translate-y-0.5 hover:border-orange-400/20`}><div className="flex items-center justify-between gap-3"><span className={`border px-2 py-1 text-[8px] uppercase tracking-widest ${severityClass(pattern.severity)}`}>{pattern.severity}</span><Copy size={13} className="text-slate-700" /></div><div className="mt-5 text-sm font-semibold">{pattern.name}</div><div className="mt-2 font-mono text-[10px] text-slate-500">{pattern.field} {pattern.operator} {String(pattern.value)}</div><div className="mt-4 flex items-center gap-2 text-[9px] uppercase tracking-widest text-orange-300">Use pattern <ArrowRight size={12} /></div></button>
            ))}
          </section>
        )}
      </main>

      {studio.open && <PolicyStudio initial={studio.rule} onClose={() => setStudio({ open: false, rule: null })} onSaved={() => setStudio({ open: false, rule: null })} />}
      {selected && <PolicyInspector rule={selected} onClose={() => setSelected(null)} onEdit={() => { setSelected(null); setStudio({ open: true, rule: selected }); }} />}
    </div>
  );
}
