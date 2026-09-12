import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Check, Network, Radio, ShieldCheck, Sparkles, UserPlus, AlertTriangle, Save } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuthStore } from '../stores/auth.js';
import { normalizePhone, isValidPhone } from '../lib/phone.js';

type Domain = 'fleet' | 'cds';
type Contact = { name: string; email: string; role: string };
type Form = { company: string; name: string; email: string; phone: string; country: string; timezone: string };
type Draft = { step: number; form: Form; domains: Domain[]; contacts: Contact[]; events: string[]; channel: string; clientId?: string; cdsCustomerId?: string; recipientId?: string; completedDomains?: Domain[]; done?: boolean; updatedAt?: string };

const KEY = 'sonalit:client-intelligence:onboarding:v5';
const STEPS = ['Identity', 'Scope', 'Contacts', 'Contract', 'Simulation', 'Activation'];
const EVENTS = [
  ['cds.booking_created', 'Booking created'], ['cds.booking_approved', 'Booking approved'], ['cds.dispatch', 'Dispatch / trip start'],
  ['cds.trip_delayed', 'Trip delay / exception'], ['cds.at_port', 'At port'], ['cds.delivery', 'Delivery'],
  ['cds.elock_tamper', 'E-lock tamper / security'], ['cds.client_pulse', 'Client Pulse / manifest digest'],
  ['fleet.operational', 'Fleet operational events'], ['fleet.security', 'Fleet security incidents'],
] as const;

const initial: Draft = {
  step: 0,
  form: { company: '', name: '', email: '', phone: '', country: 'Kenya', timezone: 'Africa/Nairobi' },
  domains: ['cds'],
  contacts: [{ name: '', email: '', role: 'Operations' }],
  events: ['cds.booking_created', 'cds.dispatch', 'cds.delivery', 'cds.elock_tamper', 'cds.client_pulse'],
  channel: 'email',
};

function readDraft(): Draft {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return initial;
    const saved = JSON.parse(raw) as Partial<Draft>;
    return { ...initial, ...saved, form: { ...initial.form, ...(saved.form ?? {}) } };
  } catch { return initial; }
}

export default function ClientOnboardingV3() {
  const isAdmin = useAuthStore(s => s.user?.role === 'admin');
  const [draft, setDraft] = useState<Draft>(initial);
  const [hydrated, setHydrated] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'info' | 'error' | 'success'; text: string } | null>(null);
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'restored'>('saved');

  useEffect(() => {
    if (!isAdmin) return;
    const saved = readDraft();
    setDraft(saved);
    setSaveState(localStorage.getItem(KEY) ? 'restored' : 'saved');
    setHydrated(true);
  }, [isAdmin]);

  useEffect(() => {
    if (!hydrated || !isAdmin) return;
    setSaveState('saving');
    const timer = window.setTimeout(() => {
      try {
        localStorage.setItem(KEY, JSON.stringify({ ...draft, updatedAt: new Date().toISOString() }));
        setSaveState('saved');
      } catch { setSaveState('saved'); }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [draft, hydrated, isAdmin]);

  const clients = useQuery<any[]>({ queryKey: ['client-intelligence-v5-clients'], queryFn: async () => (await api.get('/portal/clients')).data?.data ?? [], enabled: isAdmin });
  const cdsCustomers = useQuery<any[]>({ queryKey: ['client-intelligence-v5-cds'], queryFn: async () => (await api.get('/cds/customers')).data?.data ?? [], enabled: isAdmin && draft.domains.includes('cds') });

  const patch = (p: Partial<Draft>) => setDraft(d => ({ ...d, ...p }));
  const formPatch = (p: Partial<Form>) => setDraft(d => ({ ...d, form: { ...d.form, ...p } }));
  const duplicate = useMemo(() => {
    const email = draft.form.email.trim().toLowerCase();
    const company = draft.form.company.trim().toLowerCase();
    return (clients.data ?? []).find(c => c.id !== draft.clientId && ((email && String(c.email ?? '').toLowerCase() === email) || (company && String(c.company ?? c.name ?? '').toLowerCase() === company)));
  }, [clients.data, draft.clientId, draft.form.email, draft.form.company]);

  const activate = useMutation({
    mutationFn: async () => {
      const { form, domains, contacts, events, channel } = draft;
      if (!form.company.trim()) throw new Error('Organisation is required.');
      if (!form.name.trim()) throw new Error('Primary contact name is required.');
      if (!form.email.trim()) throw new Error('Primary email is required.');
      if (!form.phone.trim()) throw new Error('Primary contact phone is required.');
      const normalizedPhone = normalizePhone(form.phone, form.country);
      if (!normalizedPhone || !isValidPhone(form.phone, form.country)) throw new Error('Enter a valid primary contact phone number.');
      if (duplicate) throw new Error(`An existing client matches ${duplicate.company || duplicate.name || duplicate.email}. Resolve the duplicate before activation.`);

      let clientId = draft.clientId;
      if (!clientId) {
        const r = await api.post('/portal/clients', { name: form.name.trim(), email: form.email.trim().toLowerCase(), company: form.company.trim(), phone: normalizedPhone, country: form.country });
        clientId = r.data?.data?.id;
        if (!clientId) throw new Error('Client identity was not created.');
        patch({ clientId });
      }

      let cdsCustomerId = draft.cdsCustomerId;
      if (domains.includes('cds') && !cdsCustomerId) {
        const email = form.email.trim().toLowerCase();
        const company = form.company.trim().toLowerCase();
        const existing = (cdsCustomers.data ?? []).find(c => (email && String(c.email ?? '').toLowerCase() === email) || (company && String(c.company_name ?? '').toLowerCase() === company));
        cdsCustomerId = existing?.id;
        if (!cdsCustomerId) {
          const r = await api.post('/cds/customers', {
            company_name: form.company.trim(), contact_person: form.name.trim(), phone: normalizedPhone,
            email, country: form.country, status: 'active',
          });
          cdsCustomerId = r.data?.data?.id;
        }
        if (!cdsCustomerId) throw new Error('CDS customer identity could not be established.');
        patch({ cdsCustomerId });
      }

      const primary = contacts.find(c => c.email.trim()) ?? { name: form.name, email: form.email, role: 'Operations' };
      let recipientId = draft.recipientId;
      if (!recipientId) {
        // Communication recipients are email identities; phone belongs to the client/CDS customer record.
        // The recipient API schema intentionally does not accept a phone field.
        const r = await api.post('/communications/recipients', { email: primary.email.trim().toLowerCase(), name: primary.name.trim() || form.name.trim(), company: form.company.trim(), enabled: true });
        recipientId = r.data?.data?.id;
        if (!recipientId) throw new Error('Communication recipient could not be created.');
        patch({ recipientId });
      }

      const completed = new Set(draft.completedDomains ?? []);
      for (const domain of domains) {
        if (completed.has(domain)) continue;
        const r = await api.post('/communications/enrollments', {
          recipient_id: recipientId,
          domain,
          // Fleet enrollments are scoped to the cargo client; CDS enrollments are scoped
          // exclusively to the authoritative CDS customer. Never send both IDs together.
          client_id: domain === 'fleet' ? clientId : null,
          cds_customer_id: domain === 'cds' ? cdsCustomerId : null,
          contact_role: primary.role,
          locale: 'en-KE',
          timezone: form.timezone,
          status: 'pending_verification',
        });
        const enrollmentId = r.data?.data?.id;
        if (!enrollmentId) throw new Error(`The ${domain.toUpperCase()} enrollment could not be created.`);
        const selected = events.filter(event => domain === 'cds' ? event.startsWith('cds.') : event.startsWith('fleet.'));
        if (selected.length) await api.put(`/communications/enrollments/${enrollmentId}/subscriptions`, { subscriptions: selected.map(event_type => ({ event_type, channel, delivery_mode: 'immediate', enabled: false, critical_override: true })) });
        completed.add(domain);
        patch({ completedDomains: [...completed] });
      }
      return clientId;
    },
    onSuccess: () => { patch({ done: true, step: 5 }); setNotice({ kind: 'success', text: 'Client initialized successfully. Communication routes remain disabled until explicit verification.' }); },
    onError: (error: any) => setNotice({ kind: 'error', text: error?.response?.data?.error ?? error?.message ?? 'Activation stopped safely. Your saved progress is intact; retry to resume.' }),
  });

  if (!isAdmin) return <div className="flex min-h-[70vh] items-center justify-center"><div className="rounded-2xl border border-red-400/20 bg-red-400/[.04] p-8 text-center"><Radio className="mx-auto text-red-300" size={28}/><h1 className="mt-3 text-lg font-semibold text-white">Admin Communications Control</h1><p className="mt-2 max-w-sm text-xs leading-5 text-slate-500">Client Intelligence exists only on the Admin account.</p></div></div>;

  const { step, form, domains, contacts, events, channel, done } = draft;
  const phoneValid = isValidPhone(form.phone, form.country);
  const canNext = step === 0 ? !!form.company.trim() && !!form.name.trim() && !!form.email.trim() && phoneValid && !duplicate : step === 1 ? domains.length > 0 : step === 2 ? contacts.some(c => c.email.trim()) : step === 3 ? events.length > 0 : true;
  const setContact = (index: number, p: Partial<Contact>) => patch({ contacts: contacts.map((c, i) => i === index ? { ...c, ...p } : c) });
  const clearDraft = () => { localStorage.removeItem(KEY); setDraft(initial); setNotice({ kind: 'info', text: 'Saved onboarding draft cleared.' }); setSaveState('saved'); };
  const readiness = Math.min(100, Math.round(((step + (done ? 1 : 0)) / 6) * 100));

  return <div className="min-h-full space-y-4 text-slate-100">
    <header className="relative overflow-hidden rounded-3xl border border-white/[.08] bg-slate-950 p-6 shadow-2xl"><div className="pointer-events-none absolute -right-20 -top-24 h-72 w-72 rounded-full bg-orange-500/10 blur-3xl"/><div className="relative flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between"><div><div className="flex items-center gap-2 text-[9px] font-mono uppercase tracking-[.28em] text-orange-300"><Sparkles size={12}/> SONALIT // CLIENT INTELLIGENCE</div><h1 className="mt-2 text-3xl font-semibold tracking-tight">Initialize client</h1><p className="mt-1 max-w-2xl text-xs leading-5 text-slate-500">A controlled client setup with durable progress, explicit communication authority and resumable activation.</p></div><div className="flex items-center gap-2 rounded-2xl border border-white/[.07] bg-white/[.02] px-4 py-3"><Save size={14} className={saveState === 'saving' ? 'text-orange-300' : 'text-emerald-300'}/><div><div className="text-[9px] font-mono uppercase tracking-[.18em] text-slate-500">Onboarding state</div><div className="mt-1 text-xs font-semibold text-white">{saveState === 'saving' ? 'Saving…' : saveState === 'restored' ? 'Draft restored' : 'Saved'}</div></div></div></div></header>
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]"><main className="overflow-hidden rounded-3xl border border-white/[.07] bg-slate-950/70 shadow-2xl"><div className="overflow-x-auto border-b border-white/[.06] p-3"><div className="flex min-w-[680px] gap-1">{STEPS.map((label, i) => <button key={label} onClick={() => i <= step && patch({ step: i })} className={`flex flex-1 items-center gap-2 rounded-xl p-2 text-left ${i === step ? 'bg-white/[.06]' : 'hover:bg-white/[.025]'}`}><span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-[9px] font-mono ${i < step || done ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300' : i === step ? 'border-orange-400/40 bg-orange-400/10 text-orange-300' : 'border-white/10 text-slate-600'}`}>{i < step || done ? <Check size={13}/> : i + 1}</span><span className="text-[10px] font-semibold text-slate-400">{label}</span></button>)}</div></div><div className="p-5 sm:p-7">{notice && <div className={`mb-5 flex items-start gap-2 rounded-xl border p-3 text-xs ${notice.kind === 'error' ? 'border-red-400/20 bg-red-400/[.04] text-red-100' : notice.kind === 'success' ? 'border-emerald-400/20 bg-emerald-400/[.04] text-emerald-100' : 'border-cyan-400/15 bg-cyan-400/[.035] text-cyan-100'}`}>{notice.kind === 'error' ? <AlertTriangle size={15} className="mt-0.5"/> : <Check size={15} className="mt-0.5"/>}<span>{notice.text}</span></div>}
      {step === 0 && <section><Kicker>01 / Identity</Kicker><h2 className="mt-2 text-xl font-semibold">Resolve the organisation</h2><p className="mt-1 text-xs text-slate-500">These identity fields are the source of truth for activation. Phone is required because CDS customer records require a reachable contact.</p><div className="mt-6 grid gap-4 sm:grid-cols-2"><Field label="Organisation *" value={form.company} onChange={v => formPatch({ company: v })} placeholder="Acme Logistics Ltd"/><Field label="Primary contact *" value={form.name} onChange={v => formPatch({ name: v })} placeholder="Jane Doe"/><Field label="Primary email *" value={form.email} onChange={v => formPatch({ email: v })} placeholder="operations@acme.example" type="email"/><Field label="Primary phone *" value={form.phone} onChange={v => formPatch({ phone: v })} placeholder="+254 7XX XXX XXX" type="tel"/><Field label="Country" value={form.country} onChange={v => formPatch({ country: v })} placeholder="Kenya"/><Field label="Timezone" value={form.timezone} onChange={v => formPatch({ timezone: v })} placeholder="Africa/Nairobi"/></div>{form.phone.trim() && !phoneValid && <Warning>Enter a valid phone number before continuing.</Warning>}{duplicate && <Warning>An existing client matches this identity. Resolve the duplicate before continuing.</Warning>}</section>}
      {step === 1 && <section><Kicker>02 / Scope</Kicker><h2 className="mt-2 text-xl font-semibold">Define the operational world</h2><p className="mt-1 text-xs text-slate-500">Fleet and CDS are independent domains. CDS is always bound to the exact customer created for this client.</p><div className="mt-6 grid gap-3 sm:grid-cols-2">{([['fleet','Fleet Operations','Convoys, vehicles, operational and security events'],['cds','Container Delivery System','Bookings, containers, e-locks, delivery and Client Pulse']] as const).map(([id,title,description]) => { const active=domains.includes(id); return <button key={id} onClick={() => patch({ domains: active ? domains.filter(x => x !== id) : [...domains,id] })} className={`rounded-2xl border p-5 text-left transition ${active ? 'border-orange-400/30 bg-orange-400/[.05]' : 'border-white/[.06] bg-white/[.015]'}`}><div className="flex items-center justify-between"><div><div className="text-sm font-semibold text-white">{title}</div><div className="mt-1 text-xs text-slate-500">{description}</div></div><span className={`h-4 w-4 rounded-full border ${active ? 'border-orange-300 bg-orange-300' : 'border-white/20'}`}/></div></button> })}</div></section>}
      {step === 2 && <section><Kicker>03 / Contacts</Kicker><h2 className="mt-2 text-xl font-semibold">Assign communication contacts</h2><p className="mt-1 text-xs text-slate-500">Each enrollment uses the selected email identity and remains disabled until verified.</p><div className="mt-6 space-y-3">{contacts.map((c,i)=><div key={i} className="grid gap-3 rounded-2xl border border-white/[.06] p-4 sm:grid-cols-[1fr_1fr_180px]"><Field label="Name" value={c.name} onChange={v=>setContact(i,{name:v})} placeholder="Jane Doe"/><Field label="Email *" value={c.email} onChange={v=>setContact(i,{email:v})} placeholder="operations@acme.example" type="email"/><Field label="Role" value={c.role} onChange={v=>setContact(i,{role:v})} placeholder="Operations"/></div>)}</div></section>}
      {step === 3 && <section><Kicker>04 / Contract</Kicker><h2 className="mt-2 text-xl font-semibold">Choose the event contract</h2><p className="mt-1 text-xs text-slate-500">Selected events are provisioned disabled and require explicit verification before delivery.</p><div className="mt-6 grid gap-2 sm:grid-cols-2">{EVENTS.filter(([event])=>domains.includes(event.startsWith('cds.')?'cds':'fleet')).map(([event,label])=><label key={event} className="flex items-center gap-3 rounded-xl border border-white/[.06] p-3"><input type="checkbox" checked={events.includes(event)} onChange={e=>patch({events:e.target.checked?[...events,event]:events.filter(x=>x!==event)})}/><span className="text-xs text-slate-300">{label}</span></label>)}</div></section>}
      {step === 4 && <section><Kicker>05 / Simulation</Kicker><h2 className="mt-2 text-xl font-semibold">Review the activation graph</h2><div className="mt-6 grid gap-3 sm:grid-cols-3"><Metric label="Domains" value={String(domains.length)}/><Metric label="Contacts" value={String(contacts.filter(c=>c.email.trim()).length)}/><Metric label="Events" value={String(events.length)}/></div><div className="mt-5 rounded-2xl border border-white/[.06] p-4 text-xs text-slate-400">{domains.map(d=><div key={d} className="flex items-center justify-between border-b border-white/[.05] py-3 last:border-0"><span>{d.toUpperCase()} enrollment</span><span className="font-mono text-slate-500">pending_verification</span></div>)}</div></section>}
      {step === 5 && <section><Kicker>06 / Activation</Kicker><h2 className="mt-2 text-xl font-semibold">Commit client intelligence</h2><p className="mt-1 max-w-2xl text-xs leading-5 text-slate-500">Activation creates the client identity, domain-specific customer binding and communication policy. Existing completed domains are skipped safely on retry.</p><div className="mt-6 grid gap-3 sm:grid-cols-3"><Metric label="Client" value={draft.clientId ? 'Ready' : 'New'}/><Metric label="CDS customer" value={domains.includes('cds') ? (draft.cdsCustomerId ? 'Ready' : 'Pending') : 'N/A'}/><Metric label="Recipient" value={draft.recipientId ? 'Ready' : 'New'}/></div><button disabled={activate.isPending || done} onClick={()=>activate.mutate()} className="mt-6 flex items-center justify-center gap-2 rounded-xl bg-orange-400 px-4 py-3 text-sm font-semibold text-slate-950 disabled:opacity-50">{done ? 'Activated' : activate.isPending ? 'Activating…' : 'Activate client'}<ArrowRight size={16}/></button>{done && <button onClick={clearDraft} className="mt-3 w-full rounded-xl border border-white/[.08] px-4 py-3 text-xs text-slate-400">Start another onboarding</button>}</section>}
      <div className="mt-8 flex items-center justify-between border-t border-white/[.06] pt-5"><button disabled={step===0 || activate.isPending} onClick={()=>patch({step:step-1})} className="flex items-center gap-2 rounded-xl border border-white/[.08] px-4 py-2 text-xs text-slate-400 disabled:opacity-30"><ArrowLeft size={14}/> Back</button>{step < 5 && <button disabled={!canNext || activate.isPending} onClick={()=>patch({step:step+1})} className="flex items-center gap-2 rounded-xl bg-white px-4 py-2 text-xs font-semibold text-slate-950 disabled:opacity-30">Continue <ArrowRight size={14}/></button>}</div></div></main><aside className="space-y-4"><div className="rounded-3xl border border-white/[.07] bg-slate-950/70 p-5"><div className="flex items-center gap-2 text-[9px] font-mono uppercase tracking-[.2em] text-orange-300"><ShieldCheck size={13}/> Authority boundary</div><p className="mt-3 text-xs leading-5 text-slate-500">Fleet notifications are client-scoped. CDS notifications are customer-scoped. The two identities are deliberately kept separate.</p></div><div className="rounded-3xl border border-white/[.07] bg-slate-950/70 p-5"><div className="flex items-center gap-2 text-[9px] font-mono uppercase tracking-[.2em] text-cyan-300"><Network size={13}/> Readiness</div><div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/[.06]"><div className="h-full rounded-full bg-cyan-300" style={{width:`${readiness}%`}}/></div><div className="mt-2 flex justify-between text-[9px] font-mono text-slate-500"><span>Activation graph</span><span>{readiness}%</span></div></div></aside></div>
  </div>;
}

function Kicker({children}:{children:React.ReactNode}) { return <div className="text-[9px] font-mono uppercase tracking-[.24em] text-orange-300">{children}</div>; }
function Field({label,value,onChange,placeholder,type='text'}:{label:string;value:string;onChange:(v:string)=>void;placeholder:string;type?:string}) { return <label className="block"><span className="mb-1.5 block text-[9px] font-mono uppercase tracking-[.16em] text-slate-500">{label}</span><input type={type} value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder} className="w-full rounded-xl border border-white/[.08] bg-white/[.025] px-3 py-2.5 text-xs text-white outline-none placeholder:text-slate-700 focus:border-orange-300/30"/></label>; }
function Warning({children}:{children:React.ReactNode}) { return <div className="mt-4 rounded-xl border border-red-400/20 bg-red-400/[.04] px-3 py-2 text-xs text-red-100">{children}</div>; }
function Metric({label,value}:{label:string;value:string}) { return <div className="rounded-2xl border border-white/[.06] bg-white/[.015] p-4"><div className="text-[9px] font-mono uppercase tracking-[.16em] text-slate-500">{label}</div><div className="mt-2 text-sm font-semibold text-white">{value}</div></div>; }
