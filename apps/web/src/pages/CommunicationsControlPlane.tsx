import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Mail,
  Plus,
  Radio,
  RefreshCw,
  Search,
  Send,
  Shield,
  Sparkles,
  Users,
  X,
  Zap,
} from 'lucide-react';
import { api } from '../lib/api.js';

type Subscription = {
  id: string;
  event_type: string;
  channel: string;
  delivery_mode: string;
  enabled: boolean;
  critical_override: boolean;
};

type Enrollment = {
  id: string;
  domain: 'platform' | 'fleet' | 'cds';
  cds_customer_id: string | null;
  contact_role: string | null;
  locale: string | null;
  timezone: string | null;
  status: string;
  subscriptions: Subscription[];
};

type Recipient = {
  id: string;
  email: string;
  name: string | null;
  company: string | null;
  enabled: boolean;
  enrollments: Enrollment[];
};

type Customer = {
  id: string;
  company_name: string;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  status: string | null;
};

type Delivery = {
  id: string;
  created_at: string;
  email?: string | null;
  domain?: string | null;
  event_type: string;
  channel: string;
  status: string;
};

type Tab = 'command' | 'identities' | 'customers' | 'audit';
type Notice = { kind: 'ok' | 'warn' | 'error'; text: string };

const PULSE_EVENT = 'cds.client_pulse';

export default function CommunicationsControlPlane() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>('command');
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [showPulse, setShowPulse] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [form, setForm] = useState({ email: '', name: '', company: '' });

  const recipientsQuery = useQuery<{ data: Recipient[] }>({
    queryKey: ['communications-control'],
    queryFn: () => api.get('/communications/recipients').then((response) => response.data),
  });

  const customersQuery = useQuery<{ data: Customer[] }>({
    queryKey: ['communications-customers'],
    queryFn: () => api.get('/communications/customers').then((response) => response.data),
  });

  const deliveryQuery = useQuery<{ data: Delivery[] }>({
    queryKey: ['communications-delivery'],
    queryFn: () => api.get('/communications/delivery?limit=80').then((response) => response.data),
    enabled: tab === 'audit',
  });

  const recipients = recipientsQuery.data?.data ?? [];
  const customers = customersQuery.data?.data ?? [];
  const enrollments = recipients.flatMap((recipient) => recipient.enrollments ?? []);
  const activeIdentities = recipients.filter((recipient) => recipient.enabled).length;
  const activeRoutes = enrollments.filter((enrollment) => ['active', 'verified'].includes(enrollment.status)).length;
  const cdsRoutes = enrollments.filter((enrollment) => enrollment.domain === 'cds');
  const pulseRoutes = cdsRoutes.filter((enrollment) =>
    ['active', 'verified'].includes(enrollment.status) &&
    enrollment.subscriptions?.some(
      (subscription) =>
        subscription.event_type === PULSE_EVENT &&
        subscription.channel === 'email' &&
        subscription.enabled,
    ),
  );
  const attentionCount = recipients.filter(
    (recipient) =>
      !recipient.enrollments?.length ||
      recipient.enrollments.some((enrollment) => enrollment.status === 'pending_verification'),
  ).length;

  const filteredRecipients = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return recipients;
    return recipients.filter((recipient) =>
      [
        recipient.email,
        recipient.name,
        recipient.company,
        ...recipient.enrollments.map((enrollment) => enrollment.cds_customer_id),
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query)),
    );
  }, [recipients, search]);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['communications-control'] });
    void queryClient.invalidateQueries({ queryKey: ['communications-customers'] });
    void queryClient.invalidateQueries({ queryKey: ['communications-delivery'] });
  };

  const addIdentity = useMutation({
    mutationFn: () =>
      api.post('/communications/recipients', {
        email: form.email.trim().toLowerCase(),
        name: form.name.trim() || null,
        company: form.company.trim() || null,
        enabled: true,
      }),
    onSuccess: () => {
      setShowAdd(false);
      setForm({ email: '', name: '', company: '' });
      setNotice({ kind: 'ok', text: 'Identity created. Delivery authority remains explicit.' });
      invalidate();
    },
    onError: (error: any) =>
      setNotice({ kind: 'error', text: error?.response?.data?.error ?? 'Identity creation failed.' }),
  });

  const pulseDispatch = useMutation({
    mutationFn: () => api.post('/settings/cds-client-pulse/send', {}),
    onSuccess: (response) => {
      const queued = response.data?.data?.queued ?? 0;
      setShowPulse(false);
      setNotice({ kind: 'ok', text: `Client Pulse dispatched. ${queued} delivery job${queued === 1 ? '' : 's'} queued.` });
      invalidate();
    },
    onError: (error: any) =>
      setNotice({ kind: 'error', text: error?.response?.data?.error ?? 'Client Pulse dispatch failed.' }),
  });

  const saveEnrollment = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post('/communications/enrollments', body),
    onSuccess: () => {
      setNotice({ kind: 'ok', text: 'Communication route saved.' });
      invalidate();
    },
    onError: (error: any) =>
      setNotice({ kind: 'error', text: error?.response?.data?.error ?? 'Route creation failed.' }),
  });

  const updateEnrollment = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      api.patch(`/communications/enrollments/${id}`, { status }),
    onSuccess: () => {
      setNotice({ kind: 'ok', text: 'Route status updated.' });
      invalidate();
    },
    onError: (error: any) =>
      setNotice({ kind: 'error', text: error?.response?.data?.error ?? 'Route update failed.' }),
  });

  const updateSubscription = useMutation({
    mutationFn: ({ id, eventType, enabled }: { id: string; eventType: string; enabled: boolean }) =>
      api.put(`/communications/enrollments/${id}/subscriptions`, {
        subscriptions: [
          {
            event_type: eventType,
            channel: 'email',
            delivery_mode: 'immediate',
            critical_override: true,
            enabled,
          },
        ],
      }),
    onSuccess: () => {
      setNotice({ kind: 'ok', text: 'Subscription updated.' });
      invalidate();
    },
    onError: (error: any) =>
      setNotice({ kind: 'error', text: error?.response?.data?.error ?? 'Subscription update failed.' }),
  });

  const refreshAll = () => {
    void recipientsQuery.refetch();
    void customersQuery.refetch();
    if (tab === 'audit') void deliveryQuery.refetch();
  };

  return (
    <div className="min-h-full max-w-[1720px] space-y-5 pb-10 text-slate-200">
      <header className="relative overflow-hidden rounded-[28px] border border-white/[.08] bg-slate-950 p-5 shadow-2xl shadow-black/20 sm:p-7">
        <div className="pointer-events-none absolute -right-24 -top-32 h-80 w-80 rounded-full bg-orange-500/[.10] blur-3xl" />
        <div className="pointer-events-none absolute -bottom-40 left-1/3 h-80 w-80 rounded-full bg-sky-500/[.06] blur-3xl" />
        <div className="relative flex flex-col gap-7 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-3xl">
            <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.25em] text-orange-300">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,.7)]" />
              Admin command surface
            </div>
            <h1 className="mt-2 text-3xl font-semibold tracking-[-.03em] text-white sm:text-4xl">Communications Centre</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-400">
              Control who can receive what, for which customer, through which route — and see what actually happened.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={refreshAll}
              className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[.035] px-4 py-2.5 text-xs font-semibold text-slate-300 transition hover:bg-white/[.07]"
            >
              <RefreshCw size={14} className={recipientsQuery.isFetching ? 'animate-spin' : ''} />
              Refresh
            </button>
            <button
              onClick={() => setShowAdd(true)}
              className="inline-flex items-center gap-2 rounded-xl bg-orange-500 px-4 py-2.5 text-xs font-bold text-white shadow-lg shadow-orange-950/30 transition hover:bg-orange-400"
            >
              <Plus size={14} /> New identity
            </button>
          </div>
        </div>

        <div className="relative mt-7 grid grid-cols-2 gap-2 lg:grid-cols-5">
          <Metric label="Identities" value={recipients.length} detail={`${activeIdentities} enabled`} icon={Users} />
          <Metric label="Active routes" value={activeRoutes} detail={`${enrollments.length} total`} icon={Zap} />
          <Metric label="CDS routes" value={cdsRoutes.length} detail={`${customers.length} customers`} icon={Radio} />
          <Metric label="Pulse ready" value={pulseRoutes.length} detail="customer-bound" icon={Send} accent />
          <Metric label="Attention" value={attentionCount} detail={attentionCount ? 'needs review' : 'clear'} icon={AlertTriangle} warning={attentionCount > 0} />
        </div>
      </header>

      {notice && (
        <div
          role="status"
          className={`flex items-start gap-3 rounded-2xl border px-4 py-3 text-xs ${
            notice.kind === 'error'
              ? 'border-red-400/20 bg-red-400/[.05] text-red-200'
              : notice.kind === 'warn'
                ? 'border-amber-400/20 bg-amber-400/[.05] text-amber-200'
                : 'border-emerald-400/20 bg-emerald-400/[.05] text-emerald-200'
          }`}
        >
          {notice.kind === 'error' ? <AlertTriangle size={15} className="mt-0.5" /> : <CheckCircle2 size={15} className="mt-0.5" />}
          <span className="flex-1 leading-5">{notice.text}</span>
          <button onClick={() => setNotice(null)} aria-label="Dismiss" className="text-current/60 hover:text-current"><X size={15} /></button>
        </div>
      )}

      <nav className="sticky top-2 z-30 grid grid-cols-2 gap-1 rounded-2xl border border-white/[.08] bg-slate-950/90 p-1.5 shadow-xl shadow-black/20 backdrop-blur-xl sm:grid-cols-4">
        <NavButton active={tab === 'command'} onClick={() => setTab('command')} icon={Radio} label="Command" />
        <NavButton active={tab === 'identities'} onClick={() => setTab('identities')} icon={Users} label="Identities" />
        <NavButton active={tab === 'customers'} onClick={() => setTab('customers')} icon={Shield} label="CDS customers" />
        <NavButton active={tab === 'audit'} onClick={() => setTab('audit')} icon={Clock3} label="Delivery" />
      </nav>

      {tab === 'command' && (
        <CommandView
          pulseRoutes={pulseRoutes}
          customers={customers}
          attentionCount={attentionCount}
          dispatching={pulseDispatch.isPending}
          onPulse={() => setShowPulse(true)}
          onIdentities={() => setTab('identities')}
          onCustomers={() => setTab('customers')}
          onAudit={() => setTab('audit')}
        />
      )}

      {tab === 'identities' && (
        <IdentitiesView
          recipients={filteredRecipients}
          customers={customers}
          search={search}
          onSearch={setSearch}
          onAdd={() => setShowAdd(true)}
          onEnroll={(body) => saveEnrollment.mutate(body)}
          onStatus={(id, status) => updateEnrollment.mutate({ id, status })}
          onSubscription={(id, eventType, enabled) => updateSubscription.mutate({ id, eventType, enabled })}
        />
      )}

      {tab === 'customers' && <CustomersView customers={customers} enrollments={enrollments} onIdentities={() => setTab('identities')} />}

      {tab === 'audit' && <DeliveryView deliveries={deliveryQuery.data?.data ?? []} loading={deliveryQuery.isFetching} />}

      {showAdd && (
        <IdentityModal
          form={form}
          setForm={setForm}
          busy={addIdentity.isPending}
          onClose={() => setShowAdd(false)}
          onSubmit={() => addIdentity.mutate()}
        />
      )}

      {showPulse && (
        <PulseModal
          eligible={pulseRoutes}
          customers={customers}
          busy={pulseDispatch.isPending}
          onClose={() => setShowPulse(false)}
          onConfirm={() => pulseDispatch.mutate()}
        />
      )}
    </div>
  );
}

function CommandView({
  pulseRoutes,
  customers,
  attentionCount,
  dispatching,
  onPulse,
  onIdentities,
  onCustomers,
  onAudit,
}: {
  pulseRoutes: Enrollment[];
  customers: Customer[];
  attentionCount: number;
  dispatching: boolean;
  onPulse: () => void;
  onIdentities: () => void;
  onCustomers: () => void;
  onAudit: () => void;
}) {
  const ready = pulseRoutes.length > 0;

  return (
    <div className="space-y-5">
      <section className="grid gap-5 xl:grid-cols-[1.35fr_.65fr]">
        <section className="relative overflow-hidden rounded-[26px] border border-orange-400/15 bg-[radial-gradient(circle_at_90%_0%,rgba(249,115,22,.12),transparent_42%)] bg-slate-950 p-5 sm:p-7">
          <div className="absolute right-7 top-7 hidden h-20 w-20 rounded-full border border-orange-300/10 sm:block" />
          <div className="relative">
            <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.2em] text-orange-300"><Send size={13} /> Dispatch control</div>
            <div className="mt-3 max-w-2xl text-2xl font-semibold tracking-tight text-white sm:text-3xl">Client Pulse</div>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-400">
              Send each enrolled CDS customer only its own active-bookings manifest. The route is resolved from the customer relationship — never from a global recipient list.
            </p>

            <div className="mt-6 flex flex-wrap gap-2">
              <TrustPill icon={Shield} text="Customer-bound" />
              <TrustPill icon={Mail} text="Email" />
              <TrustPill icon={Check} text={`${pulseRoutes.length} eligible route${pulseRoutes.length === 1 ? '' : 's'}`} />
            </div>

            <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:items-center">
              <button
                onClick={onPulse}
                disabled={!ready || dispatching}
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-orange-500 px-5 text-xs font-bold text-white shadow-xl shadow-orange-950/30 transition hover:bg-orange-400 disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-600"
              >
                {dispatching ? <RefreshCw size={15} className="animate-spin" /> : <Send size={15} />}
                {dispatching ? 'Preparing dispatch…' : ready ? 'Review & send Client Pulse' : 'Client Pulse not ready'}
              </button>
              {!ready && <span className="text-xs text-amber-300/80">Complete a customer-bound CDS route first.</span>}
            </div>
          </div>
        </section>

        <section className="rounded-[26px] border border-white/[.08] bg-slate-950 p-5 sm:p-7">
          <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.2em] text-slate-500"><Activity size={13} /> Live posture</div>
          <div className="mt-5 space-y-3">
            <HealthRow label="Identity registry" value="Operational" ok />
            <HealthRow label="CDS customer binding" value={ready ? 'Ready' : 'Needs setup'} ok={ready} />
            <HealthRow label="Delivery trace" value="Auditable" ok />
            <HealthRow label="Attention queue" value={attentionCount ? `${attentionCount} to review` : 'Clear'} ok={!attentionCount} warning={attentionCount > 0} />
          </div>
          <div className="mt-5 rounded-2xl border border-white/[.06] bg-white/[.025] p-4">
            <div className="flex items-center gap-2 text-xs font-semibold text-white"><Sparkles size={14} className="text-orange-300" /> Designed for deliberate delivery</div>
            <p className="mt-2 text-[11px] leading-5 text-slate-500">Every active route is explicit, scoped and reviewable.</p>
          </div>
        </section>
      </section>

      <section className="grid gap-3 md:grid-cols-3">
        <CommandCard icon={Users} title="Identity registry" detail="Manage recipients and their authorized routes." meta={`${customers.length ? 'Connected' : 'Awaiting clients'}`} onClick={onIdentities} />
        <CommandCard icon={Radio} title="CDS customers" detail="See customer-bound communication readiness." meta={`${pulseRoutes.length} pulse-ready`} onClick={onCustomers} />
        <CommandCard icon={Clock3} title="Delivery assurance" detail="Trace dispatches, channels and outcomes." meta="Live audit" onClick={onAudit} />
      </section>
    </div>
  );
}

function IdentitiesView({
  recipients,
  customers,
  search,
  onSearch,
  onAdd,
  onEnroll,
  onStatus,
  onSubscription,
}: {
  recipients: Recipient[];
  customers: Customer[];
  search: string;
  onSearch: (value: string) => void;
  onAdd: () => void;
  onEnroll: (body: Record<string, unknown>) => void;
  onStatus: (id: string, status: string) => void;
  onSubscription: (id: string, eventType: string, enabled: boolean) => void;
}) {
  return (
    <section className="overflow-hidden rounded-[26px] border border-white/[.08] bg-slate-950">
      <div className="border-b border-white/[.07] p-5 sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[.2em] text-orange-300">Identity registry</div>
            <h2 className="mt-2 text-xl font-semibold text-white">People, not permissions</h2>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-500">An identity can exist without receiving anything. Delivery authority is established through explicit enrollment and subscriptions.</p>
          </div>
          <div className="flex w-full gap-2 lg:w-auto">
            <div className="relative min-w-0 flex-1 lg:w-80"><Search size={14} className="absolute left-3 top-3 text-slate-600" /><input value={search} onChange={(event) => onSearch(event.target.value)} placeholder="Search people or customers…" className="w-full rounded-xl border border-white/10 bg-black/20 py-2.5 pl-9 pr-3 text-xs text-white outline-none placeholder:text-slate-600 focus:border-orange-400/30" /></div>
            <button onClick={onAdd} className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-orange-500 px-4 py-2.5 text-xs font-bold text-white hover:bg-orange-400"><Plus size={14} /> Add</button>
          </div>
        </div>
      </div>
      <div className="divide-y divide-white/[.06]">
        {recipients.map((recipient) => (
          <RecipientRow key={recipient.id} recipient={recipient} customers={customers} onEnroll={onEnroll} onStatus={onStatus} onSubscription={onSubscription} />
        ))}
      </div>
      {!recipients.length && <EmptyState title="No matching identities" detail="Create an identity, then attach only the customer routes it is authorized to receive." action="Create identity" onClick={onAdd} />}
    </section>
  );
}

function RecipientRow({
  recipient,
  customers,
  onEnroll,
  onStatus,
  onSubscription,
}: {
  recipient: Recipient;
  customers: Customer[];
  onEnroll: (body: Record<string, unknown>) => void;
  onStatus: (id: string, status: string) => void;
  onSubscription: (id: string, eventType: string, enabled: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const routes = recipient.enrollments ?? [];
  const initials = (recipient.name || recipient.email).slice(0, 1).toUpperCase();

  return (
    <div className="transition hover:bg-white/[.018]">
      <button onClick={() => setOpen((value) => !value)} className="flex w-full items-center gap-3 p-4 text-left sm:p-5">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-orange-400/15 bg-orange-400/[.07] text-sm font-bold text-orange-200">{initials}</div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-white">{recipient.name || recipient.email}</div>
          <div className="mt-0.5 truncate text-[11px] text-slate-500">{recipient.email}{recipient.company ? ` · ${recipient.company}` : ''}</div>
        </div>
        <div className="hidden text-right sm:block"><div className="text-xs font-semibold text-slate-300">{routes.length} route{routes.length === 1 ? '' : 's'}</div><div className="mt-0.5 text-[10px] text-slate-600">{recipient.enabled ? 'Enabled identity' : 'Disabled identity'}</div></div>
        <span className={`h-2 w-2 shrink-0 rounded-full ${recipient.enabled ? 'bg-emerald-400' : 'bg-slate-600'}`} />
        <ChevronDown size={16} className={`shrink-0 text-slate-600 transition ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="border-t border-white/[.05] bg-black/10 p-4 sm:p-5">
          {routes.length ? (
            <div className="space-y-3">
              {routes.map((route) => (
                <RouteCard key={route.id} route={route} customers={customers} onStatus={onStatus} onSubscription={onSubscription} />
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-white/10 p-5 text-center"><div className="text-sm font-semibold text-white">No communication route</div><p className="mt-1 text-xs text-slate-500">The identity is registered, but nothing can be delivered to it yet.</p></div>
          )}
          <button onClick={() => onEnroll({ recipient_id: recipient.id, domain: 'cds', status: 'pending_verification', cds_customer_id: customers[0]?.id ?? null })} disabled={!customers.length} className="mt-3 inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[.03] px-3 py-2 text-[11px] font-semibold text-slate-300 hover:bg-white/[.06] disabled:cursor-not-allowed disabled:opacity-40"><Plus size={13} /> Add CDS route</button>
        </div>
      )}
    </div>
  );
}

function RouteCard({
  route,
  customers,
  onStatus,
  onSubscription,
}: {
  route: Enrollment;
  customers: Customer[];
  onStatus: (id: string, status: string) => void;
  onSubscription: (id: string, eventType: string, enabled: boolean) => void;
}) {
  const customer = route.cds_customer_id ? customers.find((item) => item.id === route.cds_customer_id) : null;
  const pulse = route.subscriptions?.find((subscription) => subscription.event_type === PULSE_EVENT && subscription.channel === 'email');
  const active = ['active', 'verified'].includes(route.status);

  return (
    <div className="rounded-2xl border border-white/[.07] bg-slate-950/70 p-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2"><span className="rounded-full border border-sky-400/15 bg-sky-400/[.05] px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-sky-300">{route.domain}</span><span className={`rounded-full border px-2 py-1 text-[9px] font-bold uppercase tracking-wider ${active ? 'border-emerald-400/15 bg-emerald-400/[.04] text-emerald-300' : 'border-amber-400/15 bg-amber-400/[.04] text-amber-300'}`}>{route.status}</span></div>
          <div className="mt-2 truncate text-sm font-semibold text-white">{customer?.company_name ?? route.cds_customer_id ?? 'Unbound customer'}</div>
          <div className="mt-1 text-[10px] text-slate-600">{route.contact_role || 'Communication route'}{route.timezone ? ` · ${route.timezone}` : ''}</div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {route.domain === 'cds' && <button onClick={() => onSubscription(route.id, PULSE_EVENT, !pulse?.enabled)} className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-[10px] font-semibold ${pulse?.enabled ? 'border-emerald-400/20 bg-emerald-400/[.05] text-emerald-300' : 'border-white/10 bg-white/[.03] text-slate-400'}`}><Send size={12} /> Pulse {pulse?.enabled ? 'on' : 'off'}</button>}
          <button onClick={() => onStatus(route.id, active ? 'suspended' : 'active')} className="rounded-xl border border-white/10 px-3 py-2 text-[10px] font-semibold text-slate-400 hover:bg-white/[.05]">{active ? 'Suspend' : 'Activate'}</button>
        </div>
      </div>
    </div>
  );
}

function CustomersView({ customers, enrollments, onIdentities }: { customers: Customer[]; enrollments: Enrollment[]; onIdentities: () => void }) {
  if (!customers.length) return <EmptyState title="No CDS customers yet" detail="Customer-bound communication workspaces appear here after client initialization." action="Open identities" onClick={onIdentities} />;

  return (
    <section className="space-y-4">
      <div className="rounded-[26px] border border-white/[.08] bg-slate-950 p-5 sm:p-6"><div className="text-[10px] font-semibold uppercase tracking-[.2em] text-orange-300">CDS customer network</div><h2 className="mt-2 text-xl font-semibold text-white">Communication readiness by customer</h2><p className="mt-1 max-w-2xl text-xs leading-5 text-slate-500">Each customer is an isolated communication scope. A ready customer has an active CDS route and an enabled Client Pulse email subscription.</p></div>
      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {customers.map((customer) => {
          const routes = enrollments.filter((enrollment) => enrollment.domain === 'cds' && enrollment.cds_customer_id === customer.id);
          const ready = routes.filter((route) => ['active', 'verified'].includes(route.status) && route.subscriptions?.some((subscription) => subscription.event_type === PULSE_EVENT && subscription.channel === 'email' && subscription.enabled));
          const subscriptions = routes.reduce((total, route) => total + (route.subscriptions?.filter((subscription) => subscription.enabled).length ?? 0), 0);
          return (
            <article key={customer.id} className="rounded-[24px] border border-white/[.08] bg-slate-950 p-5 transition hover:-translate-y-0.5 hover:border-orange-400/20">
              <div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="truncate text-base font-semibold text-white">{customer.company_name}</div><div className="mt-1 truncate text-xs text-slate-500">{customer.contact_name || 'No named contact'}</div></div><span className={`shrink-0 rounded-full border px-2.5 py-1 text-[9px] font-bold uppercase tracking-wider ${ready.length ? 'border-emerald-400/15 bg-emerald-400/[.04] text-emerald-300' : 'border-amber-400/15 bg-amber-400/[.04] text-amber-300'}`}>{ready.length ? 'Pulse ready' : 'Needs setup'}</span></div>
              <div className="mt-5 grid grid-cols-3 gap-2"><MiniMetric label="Routes" value={routes.length} /><MiniMetric label="Events" value={subscriptions} /><MiniMetric label="Pulse" value={ready.length} /></div>
              <div className="mt-5 flex items-center gap-2 border-t border-white/[.06] pt-4 text-[10px] text-slate-500"><Mail size={13} /><span className="truncate">{customer.email || 'No customer email'}</span><span className="ml-auto text-slate-700">isolated scope</span></div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function DeliveryView({ deliveries, loading }: { deliveries: Delivery[]; loading: boolean }) {
  return (
    <section className="overflow-hidden rounded-[26px] border border-white/[.08] bg-slate-950">
      <div className="border-b border-white/[.07] p-5 sm:p-6"><div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.2em] text-orange-300"><Clock3 size={13} /> Delivery assurance</div><h2 className="mt-2 text-xl font-semibold text-white">What was actually delivered</h2><p className="mt-1 text-xs text-slate-500">Operational evidence for dispatches, channels and outcomes.</p></div>
      {loading && !deliveries.length ? <div className="p-10 text-center text-xs text-slate-500"><RefreshCw size={18} className="mx-auto mb-3 animate-spin" />Loading delivery history…</div> : deliveries.length ? <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-xs"><thead><tr className="border-b border-white/[.06] text-[9px] font-semibold uppercase tracking-[.16em] text-slate-600"><th className="p-4">Time</th><th>Recipient</th><th>Domain</th><th>Event</th><th>Channel</th><th>Status</th></tr></thead><tbody>{deliveries.map((delivery) => <tr key={delivery.id} className="border-b border-white/[.04] text-slate-400 hover:bg-white/[.018]"><td className="whitespace-nowrap p-4">{formatDate(delivery.created_at)}</td><td>{delivery.email || '—'}</td><td>{delivery.domain || '—'}</td><td className="font-medium text-slate-300">{delivery.event_type}</td><td>{delivery.channel}</td><td><StatusBadge value={delivery.status} /></td></tr>)}</tbody></table></div> : <EmptyState title="No delivery events yet" detail="Dispatch activity and outcomes will appear here once communications are sent." />}
    </section>
  );
}

function PulseModal({ eligible, customers, busy, onClose, onConfirm }: { eligible: Enrollment[]; customers: Customer[]; busy: boolean; onClose: () => void; onConfirm: () => void }) {
  return <ModalShell title="Review Client Pulse" subtitle="Confirm the exact customer scopes before dispatch." icon={Send} onClose={onClose}>
    <div className="space-y-3">
      <div className="rounded-2xl border border-orange-400/15 bg-orange-400/[.04] p-4"><div className="flex items-center gap-2 text-xs font-semibold text-white"><Shield size={14} className="text-orange-300" /> Customer-bound dispatch</div><p className="mt-1 text-[11px] leading-5 text-slate-500">Only active CDS routes with an enabled email Client Pulse subscription are included.</p></div>
      {eligible.map((route) => { const customer = customers.find((item) => item.id === route.cds_customer_id); return <div key={route.id} className="flex items-center gap-3 rounded-xl border border-white/[.07] bg-white/[.02] p-3"><span className="h-2 w-2 rounded-full bg-emerald-400" /><div className="min-w-0 flex-1"><div className="truncate text-xs font-semibold text-white">{customer?.company_name || route.cds_customer_id || 'Bound customer'}</div><div className="text-[10px] text-slate-600">Active bookings manifest · email</div></div><Check size={14} className="text-emerald-300" /></div>; })}
    </div>
    <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><button onClick={onClose} disabled={busy} className="rounded-xl border border-white/10 px-4 py-2.5 text-xs font-semibold text-slate-400 hover:bg-white/[.04]">Cancel</button><button onClick={onConfirm} disabled={busy || !eligible.length} className="inline-flex items-center justify-center gap-2 rounded-xl bg-orange-500 px-5 py-2.5 text-xs font-bold text-white hover:bg-orange-400 disabled:opacity-40">{busy ? <RefreshCw size={14} className="animate-spin" /> : <Send size={14} />}{busy ? 'Dispatching…' : 'Confirm & send'}</button></div>
  </ModalShell>;
}

function IdentityModal({ form, setForm, busy, onClose, onSubmit }: { form: { email: string; name: string; company: string }; setForm: (value: { email: string; name: string; company: string }) => void; busy: boolean; onClose: () => void; onSubmit: () => void }) {
  const valid = form.email.includes('@');
  return <ModalShell title="Create identity" subtitle="Register a person without granting delivery authority." icon={Users} onClose={onClose}>
    <div className="space-y-4"><Field label="Email address" value={form.email} placeholder="client@example.com" type="email" onChange={(value) => setForm({ ...form, email: value })} /><Field label="Contact name" value={form.name} placeholder="Primary contact" onChange={(value) => setForm({ ...form, name: value })} /><Field label="Company" value={form.company} placeholder="Customer organisation" onChange={(value) => setForm({ ...form, company: value })} /><div className="rounded-2xl border border-sky-400/10 bg-sky-400/[.025] p-4 text-[11px] leading-5 text-slate-500"><div className="font-semibold text-slate-300">Safe by default</div>Creating an identity does not subscribe it to anything. A customer route and event subscription must be explicitly established.</div></div>
    <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><button onClick={onClose} className="rounded-xl border border-white/10 px-4 py-2.5 text-xs font-semibold text-slate-400">Cancel</button><button onClick={onSubmit} disabled={!valid || busy} className="rounded-xl bg-orange-500 px-5 py-2.5 text-xs font-bold text-white hover:bg-orange-400 disabled:opacity-40">{busy ? 'Creating…' : 'Create identity'}</button></div>
  </ModalShell>;
}

function ModalShell({ title, subtitle, icon: Icon, onClose, children }: { title: string; subtitle: string; icon: any; onClose: () => void; children: any }) {
  return <div className="fixed inset-0 z-[500] flex items-center justify-center bg-black/80 p-4 backdrop-blur-md" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}><div role="dialog" aria-modal="true" className="w-full max-w-xl overflow-hidden rounded-[28px] border border-white/10 bg-slate-950 shadow-2xl shadow-black/50"><div className="flex items-start gap-3 border-b border-white/[.07] p-5 sm:p-6"><div className="rounded-xl border border-orange-400/15 bg-orange-400/[.06] p-2.5 text-orange-300"><Icon size={17} /></div><div className="min-w-0 flex-1"><h2 className="text-lg font-semibold text-white">{title}</h2><p className="mt-1 text-xs leading-5 text-slate-500">{subtitle}</p></div><button onClick={onClose} aria-label="Close" className="rounded-xl p-2 text-slate-500 hover:bg-white/[.05] hover:text-white"><X size={17} /></button></div><div className="p-5 sm:p-6">{children}</div></div></div>;
}

function NavButton({ active, onClick, icon: Icon, label }: { active: boolean; onClick: () => void; icon: any; label: string }) {
  return <button onClick={onClick} className={`flex items-center justify-center gap-2 rounded-xl px-3 py-3 text-xs font-semibold transition ${active ? 'bg-white/[.09] text-white shadow-inner' : 'text-slate-500 hover:bg-white/[.03] hover:text-slate-300'}`}><Icon size={14} />{label}</button>;
}

function Metric({ label, value, detail, icon: Icon, accent = false, warning = false }: { label: string; value: string | number; detail: string; icon: any; accent?: boolean; warning?: boolean }) {
  return <div className={`rounded-2xl border p-4 ${accent ? 'border-orange-400/20 bg-orange-400/[.045]' : warning ? 'border-amber-400/15 bg-amber-400/[.03]' : 'border-white/[.07] bg-white/[.018]'}`}><div className="flex items-center justify-between text-[9px] font-semibold uppercase tracking-[.16em] text-slate-600"><span>{label}</span><Icon size={14} /></div><div className="mt-2 text-2xl font-semibold tracking-tight text-white">{value}</div><div className="mt-1 text-[10px] text-slate-600">{detail}</div></div>;
}

function TrustPill({ icon: Icon, text }: { icon: any; text: string }) {
  return <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[.025] px-3 py-1.5 text-[10px] font-medium text-slate-400"><Icon size={11} />{text}</span>;
}

function HealthRow({ label, value, ok, warning = false }: { label: string; value: string; ok: boolean; warning?: boolean }) {
  return <div className="flex items-center justify-between rounded-xl border border-white/[.06] bg-white/[.018] px-3.5 py-3"><span className="text-[11px] text-slate-500">{label}</span><span className="flex items-center gap-2 text-[10px] font-semibold text-slate-300"><span className={`h-1.5 w-1.5 rounded-full ${ok ? 'bg-emerald-400' : warning ? 'bg-amber-400' : 'bg-slate-600'}`} />{value}</span></div>;
}

function CommandCard({ icon: Icon, title, detail, meta, onClick }: { icon: any; title: string; detail: string; meta: string; onClick: () => void }) {
  return <button onClick={onClick} className="group rounded-2xl border border-white/[.07] bg-slate-950 p-5 text-left transition hover:-translate-y-0.5 hover:border-orange-400/20 hover:bg-slate-900"><div className="flex items-center justify-between"><span className="rounded-xl border border-white/10 bg-white/[.03] p-2.5 text-slate-400 group-hover:text-orange-300"><Icon size={16} /></span><ArrowRight size={15} className="text-slate-700 transition group-hover:translate-x-0.5 group-hover:text-orange-300" /></div><div className="mt-5 text-sm font-semibold text-white">{title}</div><p className="mt-1 text-xs leading-5 text-slate-500">{detail}</p><div className="mt-4 text-[9px] font-semibold uppercase tracking-[.15em] text-slate-700">{meta}</div></button>;
}

function MiniMetric({ label, value }: { label: string; value: string | number }) {
  return <div className="rounded-xl border border-white/[.06] bg-white/[.018] p-3"><div className="text-[9px] uppercase tracking-wider text-slate-600">{label}</div><div className="mt-1 text-sm font-semibold text-white">{value}</div></div>;
}

function StatusBadge({ value }: { value: string }) {
  const positive = ['sent', 'delivered', 'success', 'completed'].includes(value.toLowerCase());
  return <span className={`rounded-full border px-2 py-1 text-[9px] font-semibold ${positive ? 'border-emerald-400/15 bg-emerald-400/[.04] text-emerald-300' : 'border-white/10 text-slate-400'}`}>{value}</span>;
}

function Field({ label, value, placeholder, type = 'text', onChange }: { label: string; value: string; placeholder: string; type?: string; onChange: (value: string) => void }) {
  return <label className="block"><span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[.13em] text-slate-600">{label}</span><input type={type} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} className="w-full rounded-xl border border-white/10 bg-black/20 px-3.5 py-3 text-xs text-white outline-none placeholder:text-slate-700 focus:border-orange-400/30 focus:ring-2 focus:ring-orange-400/[.06]" /></label>;
}

function EmptyState({ title, detail, action, onClick }: { title: string; detail: string; action?: string; onClick?: () => void }) {
  return <div className="rounded-[26px] border border-dashed border-white/10 bg-slate-950 p-10 text-center"><div className="mx-auto flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/[.025] text-slate-600"><Radio size={17} /></div><div className="mt-4 text-sm font-semibold text-white">{title}</div><p className="mx-auto mt-1 max-w-md text-xs leading-5 text-slate-600">{detail}</p>{action && onClick && <button onClick={onClick} className="mt-5 inline-flex items-center gap-2 rounded-xl bg-orange-500 px-4 py-2.5 text-xs font-bold text-white hover:bg-orange-400">{action}<ArrowRight size={13} /></button>}</div>;
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
