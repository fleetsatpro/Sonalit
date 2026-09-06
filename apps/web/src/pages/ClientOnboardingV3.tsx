import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Check, Network, Radio, ShieldCheck, Sparkles, UserPlus, AlertTriangle, Save } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuthStore } from '../stores/auth.js';

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
      if (!/^\\+?[0-9][0-9 ()-]{6,}$/.test(form.phone.trim())) throw new Error('Enter a valid primary contact phone number.');
      if (duplicate) throw new Error(`An existing client matches ${duplicate.company || duplicate.name || duplicate.email}. Resolve the duplicate before activation.`);

      let clientId = draft.clientId;
      if (!clientId) {
        const r = await api.post('/portal/clients', { name: form.name.trim(), email: form.email.trim().toLowerCase(), company: form.company.trim(), phone: form.phone.trim() });
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
            company_name: form.company.trim(), contact_person: form.name.trim(), phone: form.phone.trim(),
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
        const r = await api.post('/communications/recipients', { email: primary.email.trim().toLowerCase(), name: primary.name.trim() || form.name.trim(), company: form.company.trim(), phone: form.phone.trim(), enabled: true });
        recipientId = r.data?.data?.id;
        if (!recipientId) throw new Error('Communication recipient could not be created.');
        patch({ recipientId });
      }

      const completed = new Set(draft.completedDomains ?? []);
      for (const domain of domains) {
        if (completed.has(domain)) continue;
        const r = await api.post('/communications/enrollments', {
          recipient_id: recipientId, domain, client_id: clientId,
          cds_customer_id: domain === 'cds' ? cdsCustomerId : null,
          contact_role: primary.role, locale: 'en-KE', timezone: form.timezone,
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
  const phoneValid = /^\\+?[0-9][0-9 ()-]{6,}$/.test(form.phone.trim());
  const canNext = step === 0 ? !!form.company.trim() && !!form.name.trim() && !!form.email.trim() && phoneValid && !duplicate : step === 1 ? domains.length > 0 : step === 2 ? contacts.some(c => c.email.trim()) : step === 3 ? events.length > 0 : true;
  const setContact = (index: number, p: Partial<Contact>) => patch({ contacts: contacts.map((c, i) => i === index ? { ...c, ...p } : c) });
  const clearDraft = () => { localStorage.removeItem(KEY); setDraft(initial); setNotice({ kind: 'info', text: 'Saved onboarding draft cleared.' }); setSaveState('saved'); };
  const readiness = Math.min(100, Math.round(((step + (done ? 1 : 0)) / 6) * 100));

  return <div className="min-h-full space-y-4 text-slate-100">
    <header className="relative overflow-hidden rounded-3xl border border-white/[.08] bg-slate-950 p-6 shadow-2xl"><div className="pointer-events-none absolute -right-20 -top-24 h-72 w-72 rounded-full bg-orange-500/10 blur-3xl"/><div className="relative flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between"><div><div className="flex items-center gap-2 text-[9px] font-mono uppercase tracking-[.28em] text-orange-300"><Sparkles size={12}/> SONALIT // CLIENT INTELLIGENCE</div><h1 className="mt-2 text-3xl font-semibold tracking-tight">Initialize client</h1><p className="mt-1 max-w-2xl text-xs leading-5 text-slate-500">A controlled client setup with durable progress, explicit communication authority and resumable activation.</p></div><div className="flex items-center gap-2 rounded-2xl border border-white/[.07] bg-white/[.02] px-4 py-3"><Save size={14} className={saveState === 'saving' ? 'text-orange-300' : 'text-emerald-300'}/><div><div className="text-[9px] font-mono uppercase tracking-[.18em] text-slate-500">Onboarding state</div><div className="mt-1 text-xs font-semibold text-white">{saveState === 'saving' ? 'Saving…' : saveState === 'restored' ? 'Draft restored' : 'Saved'}</div></div></div></div></header>
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]"><main className="overflow-hidden rounded-3xl border border-white/[.07] bg-slate-950/70 shadow-2xl"><div className="overflow-x-auto border-b border-white/[.06] p-3"><div className="flex min-w-[680px] gap-1">{STEPS.map((label, i) => <button key={label} onClick={() => i <= step && patch({ step: i })} className={`flex flex-1 items-center gap-2 rounded-xl p-2 text-left ${i === step ? 'bg-white/[.06]' : 'hover:bg-white/[.025]'}`}><span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-[9px] font-mono ${i < step || done ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300' : i === step ? 'border-orange-400/40 bg-orange-400/10 text-orange-300' : 'border-white/10 text-slate-600'}`}>{i < step || done ? <Check size={13}/> : i + 1}</span><span className="text-[10px] font-semibold text-slate-400">{label}</span></button>)}</div></div><div className="p-5 sm:p-7">{notice && <div className={`mb-5 flex items-start gap-2 rounded-xl border p-3 text-xs ${notice.kind === 'error' ? 'border-red-400/20 bg-red-400/[.04] text-red-100' : notice.kind === 'success' ? 'border-emerald-400/20 bg-emerald-400/[.04] text-emerald-100' : 'border-cyan-400/15 bg-cyan-400/[.035] text-cyan-100'}`}>{notice.kind === 'error' ? <AlertTriangle size={15} className="mt-0.5"/> : <Check size={15} className="mt-0.5"/>}<span>{notice.text}</span></div>}
      {step === 0 && <section><Kicker>01 / Identity</Kicker><h2 className="mt-2 text-xl font-semibold">Resolve the organisation</h2><p className="mt-1 text-xs text-slate-500">These identity fields are the source of truth for activation. Phone is required because CDS customer records require a reachable contact.</p><div className="mt-6 grid gap-4 sm:grid-cols-2"><Field label="Organisation *" value={form.company} onChange={v => formPatch({ company: v })} placeholder="Acme Logistics Ltd"/><Field label="Primary contact *" value={form.name} onChange={v => formPatch({ name: v })} placeholder="Jane Doe"/><Field label="Primary email *" value={form.email} onChange={v => formPatch({ email: v })} placeholder="operations@acme.example" type="email"/><Field label="Primary phone *" value={form.phone} onChange={v => formPatch({ phone: v })} placeholder="+254 7XX XXX XXX" type="tel"/><Field label="Country" value={form.country} onChange={v => formPatch({ country: v })} placeholder="Kenya"/><Field label="Timezone" value={form.timezone} onChange={v => formPatch({ timezone: v })} placeholder="Africa/Nairobi"/></div>{form.phone.trim() && !phoneValid && <Warning>Enter a valid phone number before continuing.</Warning>}{duplicate && <Warning>An existing client matches this identity. Resolve the duplicate before continuing.</Warning>}</section>}
      {step === 1 && <section><Kicker>02 / Scope</Kicker><h2 className="mt-2 text-xl font-semibold">Define the operational world</h2><p className="mt-1 text-xs text-slate-500">Fleet and CDS are independent domains. CDS is always bound to the exact customer created for this client.</p><div className="mt-6 grid gap-3 sm:grid-cols-2">{([['fleet','Fleet Operations','Convoys, vehicles, operational and security events'],['cds','Container Delivery System','Bookings, containers, e-locks, delivery and Client Pulse']] as const).map(([id,title,description]) => { const active=domains.includes(id); return <button key={id} onClick={() => patch({ domains: active ? domains.filter(x => x !== id) : [...domains,id] })} className={`rounded-2xl border p-5 text-left transition ${active ? 'border-orange-400/30 bg-orange-400/[.05]' : 'border-white/[.07] bg-white/[.015]'}`}><div className="flex justify-between"><Network className={active ? 'text-orange-300' : 'text-slate-600'}/><span className={`flex h-5 w-5 items-center justify-center rounded-full border ${active ? 'border-orange-300 bg-orange-300' : 'border-white/10'}`}>{active && <Check size={12} className="text-slate-950"/>}</span></div><div className="mt-5 text-sm font-semibold">{title}</div><p className="mt-1 text-[10px] leading-5 text-slate-500">{description}</p></button>})}</div></section>}
      {step === 2 && <section><Kicker>03 / Contacts</Kicker><h2 className="mt-2 text-xl font-semibold">Build recipient authority</h2><p className="mt-1 text-xs text-slate-500">Contacts become communication identities only through explicit enrollment.</p><div className="mt-6 space-y-3">{contacts.map((c,i)=><div key={i} className="rounded-2xl border border-white/[.07] p-4"><div className="mb-3 text-[9px] font-mono uppercase tracking-[.18em] text-slate-600">Contact {i+1}</div><div className="grid gap-3 sm:grid-cols-2"><Field label="Name" value={c.name} onChange={v=>setContact(i,{name:v})} placeholder="Jane Doe"/><Field label="Email" value={c.email} onChange={v=>setContact(i,{email:v})} placeholder="operations@acme.example" type="email"/><Field label="Role" value={c.role} onChange={v=>setContact(i,{role:v})} placeholder="Operations"/></div></div>)}<button onClick={()=>patch({contacts:[...contacts,{name:'',email:'',role:'Operations'}]})} className="rounded-xl border border-dashed border-white/10 px-4 py-3 text-[10px] text-slate-400">+ Add another contact</button></div></section>}
      {step === 3 && <section><Kicker>04 / Contract</Kicker><h2 className="mt-2 text-xl font-semibold">Define communication authority</h2><p className="mt-1 text-xs text-slate-500">Select the events this client is allowed to receive. Subscriptions are created disabled.</p><div className="mt-6 space-y-2">{EVENTS.filter(([e])=>domains.includes(e.startsWith('cds.')?'cds':'fleet')).map(([e,label])=><button key={e} onClick={()=>patch({events:events.includes(e)?events.filter(x=>x!==e):[...events,e]})} className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left ${events.includes(e)?'border-orange-400/20 bg-orange-400/[.03]':'border-white/[.06]'}`}><span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${events.includes(e)?'border-orange-300 bg-orange-300 text-slate-950':'border-white/10 text-transparent'}`}><Check size={11}/></span><span className="flex-1 text-xs">{label}</span><span className="hidden text-[8px] font-mono text-slate-700 sm:block">{e}</span></button>)}</div><div className="mt-5"><label className="text-[9px] font-mono uppercase tracking-[.18em] text-slate-600">Primary channel</label><select value={channel} onChange={e=>patch({channel:e.target.value})} className="mt-2 w-full rounded-xl border border-white/[.08] bg-slate-900 px-3 py-3 text-xs text-white outline-none"><option value="email">Email</option><option value="sms">SMS</option><option value="whatsapp">WhatsApp</option></select></div></section>}
      {step === 4 && <section><Kicker>05 / Simulation</Kicker><h2 className="mt-2 text-xl font-semibold">Prove the route</h2><p className="mt-1 text-xs text-slate-500">Dry-run only. No provider call or external communication is sent from this screen.</p><div className="mt-6 rounded-2xl border border-cyan-400/15 bg-cyan-400/[.025] p-5"><div className="flex items-center gap-3"><Radio className="text-cyan-300" size={20}/><div><div className="text-sm font-semibold">Simulation ready</div><div className="text-[10px] text-slate-500">{events.length} event routes · {domains.length} domain{domains.length===1?'':'s'} · {channel.toUpperCase()}</div></div></div><div className="mt-5 grid gap-2 sm:grid-cols-2">{[['Boundary','ORG + EXACT CLIENT'],['CDS binding',domains.includes('cds')?(draft.cdsCustomerId?'EXACT CUSTOMER':'WILL CREATE CUSTOMER'):'NOT APPLICABLE'],['Phone',phoneValid?'VALID':'REQUIRED'],['External send','DISABLED']].map(([k,v])=><div key={k} className="rounded-xl border border-white/[.06] p-3"><div className="text-[8px] font-mono uppercase text-slate-600">{k}</div><div className="mt-1 text-[10px] font-semibold text-slate-300">{v}</div></div>)}</div></div></section>}
      {step === 5 && <section><Kicker>06 / Activation</Kicker><h2 className="mt-2 text-xl font-semibold">Commit safely</h2><p className="mt-1 text-xs text-slate-500">Activation resumes from the last durable checkpoint if a remote operation fails.</p><div className="mt-6 rounded-2xl border border-orange-400/15 bg-orange-400/[.025] p-5"><div className="flex gap-3"><ShieldCheck className="text-orange-300" size={20}/><div className="flex-1"><div className="text-sm font-semibold">{done?'Client initialized':'Controlled activation'}</div><p className="mt-1 text-[10px] leading-5 text-slate-500">{form.company || 'Unnamed client'} · {domains.join(' + ').toUpperCase()} · {events.length} routes · {channel}</p><div className="mt-4 grid grid-cols-2 gap-2 text-[9px] font-mono text-slate-600"><span>CLIENT {draft.clientId?'✓':'○'}</span><span>CDS {domains.includes('cds') ? (draft.cdsCustomerId?'✓':'○') : '—'}</span><span>RECIPIENT {draft.recipientId?'✓':'○'}</span><span>ENROLLMENTS {draft.completedDomains?.length??0}/{domains.length}</span></div></div></div><button disabled={activate.isPending||done||!phoneValid} onClick={()=>activate.mutate()} className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-orange-500 px-4 py-3 text-xs font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-40">{done?<Check size={14}/>:<UserPlus size={14}/>} {done?'Client initialized':activate.isPending?'Resuming activation…':'Initialize client'}</button>{!phoneValid && !done && <p className="mt-3 text-center text-[10px] text-amber-300">Complete the required phone number in Identity before activation.</p>}</div></section>}
      <div className="mt-8 flex items-center justify-between border-t border-white/[.06] pt-4"><button disabled={step===0} onClick={()=>patch({step:step-1})} className="flex items-center gap-2 rounded-xl px-3 py-3 text-xs text-slate-500 disabled:opacity-30"><ArrowLeft size={14}/> Back</button><div className="flex items-center gap-2">{step===0 && hydrated && <button onClick={clearDraft} className="rounded-xl px-3 py-3 text-[10px] text-slate-600 hover:text-red-300">Clear saved draft</button>}{step<5&&<button disabled={!canNext} onClick={()=>patch({step:step+1})} className="flex items-center gap-2 rounded-xl bg-white px-4 py-3 text-xs font-semibold text-slate-950 disabled:opacity-30">Continue <ArrowRight size={14}/></button>}</div></div>
    </div></main><aside className="rounded-3xl border border-white/[.07] bg-slate-950/70 p-5 shadow-2xl"><div className="text-[9px] font-mono uppercase tracking-[.2em] text-slate-600">Readiness</div><div className="mt-2 text-3xl font-semibold text-white">{readiness}%</div><div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/[.06]"><div className="h-full rounded-full bg-orange-400 transition-all" style={{width:`${readiness}%`}}/></div><div className="mt-6 space-y-2">{STEPS.map((label,i)=><div key={label} className="flex items-center gap-2 rounded-xl border border-white/[.05] p-3"><span className={`h-2 w-2 rounded-full ${i<=step||done?'bg-emerald-400':'bg-slate-700'}`}/><span className="text-[10px] text-slate-400">{label}</span></div>)}</div><div className="mt-6 rounded-2xl border border-emerald-400/10 bg-emerald-400/[.02] p-4"><div className="text-[9px] font-mono uppercase tracking-[.18em] text-emerald-300">Activation guardrail</div><p className="mt-2 text-[10px] leading-5 text-slate-500">Phone is validated before any remote mutation. CDS receives the same authoritative phone value.</p></div></aside></div>
  </div>;
}

function Field({ label, value, onChange, placeholder, type='text' }: { label:string; value:string; onChange:(v:string)=>void; placeholder:string; type?:string }) { return <label className="block"><span className="text-[9px] font-mono uppercase tracking-[.16em] text-slate-600">{label}</span><input type={type} value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder} className="mt-2 w-full rounded-xl border border-white/[.08] bg-slate-900/80 px-3 py-3 text-xs text-white outline-none placeholder:text-slate-700 focus:border-orange-400/40" /></label>; }
function Kicker({ children }: { children:any }) { return <div className="text-[9px] font-mono uppercase tracking-[.22em] text-orange-300">{children}</div>; }
function Warning({ children }: { children:any }) { return <div className="mt-4 flex items-start gap-2 rounded-xl border border-amber-400/15 bg-amber-400/[.03] p-3 text-[10px] leading-5 text-amber-200"><AlertTriangle size={14} className="mt-0.5 shrink-0"/>{children}</div>; }
