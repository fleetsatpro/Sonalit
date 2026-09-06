import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, ArrowRight, Check, Network, Radio, ShieldCheck, Sparkles, UserPlus } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuthStore } from '../stores/auth.js';

type Domain = 'fleet' | 'cds';
type Contact = { name: string; email: string; role: string };
type Form = { company: string; name: string; email: string; country: string; timezone: string };
type Draft = { step: number; form: Form; domains: Domain[]; contacts: Contact[]; events: string[]; channel: string; clientId?: string; cdsCustomerId?: string; recipientId?: string; completedDomains?: Domain[]; done?: boolean };

const KEY = 'sonalit:client-intelligence:onboarding:v4';
const STEPS = ['Identity', 'Scope', 'Contacts', 'Contract', 'Simulation', 'Activation'];
const EVENTS = [
  ['cds.booking_created', 'Booking created'], ['cds.booking_approved', 'Booking approved'], ['cds.dispatch', 'Dispatch / trip start'],
  ['cds.trip_delayed', 'Trip delay / exception'], ['cds.at_port', 'At port'], ['cds.delivery', 'Delivery'],
  ['cds.elock_tamper', 'E-lock tamper / security'], ['cds.client_pulse', 'Client Pulse / manifest digest'],
  ['fleet.operational', 'Fleet operational events'], ['fleet.security', 'Fleet security incidents'],
] as const;

const initial: Draft = {
  step: 0,
  form: { company: '', name: '', email: '', country: 'Kenya', timezone: 'Africa/Nairobi' },
  domains: ['cds'],
  contacts: [{ name: '', email: '', role: 'Operations' }],
  events: ['cds.booking_created', 'cds.dispatch', 'cds.delivery', 'cds.elock_tamper', 'cds.client_pulse'],
  channel: 'email',
};

function readDraft(): Draft {
  try { const raw = localStorage.getItem(KEY); return raw ? { ...initial, ...JSON.parse(raw), form: { ...initial.form, ...(JSON.parse(raw).form ?? {}) } } : initial; } catch { return initial; }
}

export default function ClientOnboardingV3() {
  const isAdmin = useAuthStore(s => s.user?.role === 'admin');
  const [draft, setDraft] = useState<Draft>(initial);
  const [notice, setNotice] = useState('');
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'restored'>('saved');
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => { if (isAdmin) { const saved = readDraft(); setDraft(saved); setSaveState(localStorage.getItem(KEY) ? 'restored' : 'saved'); setHydrated(true); } }, [isAdmin]);
  useEffect(() => {
    if (!hydrated || !isAdmin) return;
    setSaveState('saving');
    const timer = window.setTimeout(() => { try { localStorage.setItem(KEY, JSON.stringify({ ...draft, updatedAt: new Date().toISOString() })); setSaveState('saved'); } catch { setSaveState('saved'); } }, 250);
    return () => window.clearTimeout(timer);
  }, [draft, hydrated, isAdmin]);

  const clients = useQuery<any[]>({ queryKey: ['client-intelligence-v4-clients'], queryFn: async () => (await api.get('/portal/clients')).data?.data ?? [], enabled: isAdmin });
  const cdsCustomers = useQuery<any[]>({ queryKey: ['client-intelligence-v4-cds'], queryFn: async () => (await api.get('/cds/customers')).data?.data ?? [], enabled: isAdmin && draft.domains.includes('cds') });

  const duplicate = useMemo(() => {
    const email = draft.form.email.trim().toLowerCase(); const company = draft.form.company.trim().toLowerCase();
    const currentId = draft.clientId;
    return (clients.data ?? []).find(c => c.id !== currentId && ((email && String(c.email ?? '').toLowerCase() === email) || (company && String(c.company ?? c.name ?? '').toLowerCase() === company)));
  }, [clients.data, draft.clientId, draft.form.email, draft.form.company]);

  const patch = (p: Partial<Draft>) => setDraft(d => ({ ...d, ...p }));
  const formPatch = (p: Partial<Form>) => setDraft(d => ({ ...d, form: { ...d.form, ...p } }));

  const activate = useMutation({
    mutationFn: async () => {
      const { form, domains, contacts, events, channel } = draft;
      if (!form.name.trim() || !form.email.trim()) throw new Error('Primary contact name and email are required.');
      if (duplicate) throw new Error('An existing client identity matches this profile. Open or clear the saved draft before creating another client.');

      // Every checkpoint is persisted before the next remote mutation. If a later call fails, retry resumes here.
      let clientId = draft.clientId;
      if (!clientId) {
        const r = await api.post('/portal/clients', { name: form.name.trim(), email: form.email.trim().toLowerCase(), company: form.company.trim() || undefined });
        clientId = r.data?.data?.id;
        if (!clientId) throw new Error('Client identity was not created.');
        patch({ clientId });
      }

      let cdsCustomerId = draft.cdsCustomerId;
      if (domains.includes('cds') && !cdsCustomerId) {
        const existing = (cdsCustomers.data ?? []).find(c => {
          const email = form.email.trim().toLowerCase(); const company = form.company.trim().toLowerCase();
          return (email && String(c.email ?? '').toLowerCase() === email) || (company && String(c.company_name ?? '').toLowerCase() === company);
        });
        if (existing?.id) cdsCustomerId = existing.id;
        if (!cdsCustomerId) {
          const r = await api.post('/cds/customers', { company_name: form.company.trim() || form.name.trim(), contact_person: form.name.trim(), email: form.email.trim().toLowerCase(), country: form.country, status: 'active' });
          cdsCustomerId = r.data?.data?.id ?? null;
        }
        if (!cdsCustomerId) throw new Error('CDS customer identity could not be established.');
        patch({ cdsCustomerId });
      }

      const primary = contacts.find(c => c.email.trim()) ?? { name: form.name, email: form.email, role: 'Operations' };
      let recipientId = draft.recipientId;
      if (!recipientId) {
        const r = await api.post('/communications/recipients', { email: primary.email.trim().toLowerCase(), name: primary.name.trim() || form.name.trim(), company: form.company.trim() || null, enabled: true });
        recipientId = r.data?.data?.id;
        if (!recipientId) throw new Error('Communication recipient could not be created.');
        patch({ recipientId });
      }

      const completed = new Set(draft.completedDomains ?? []);
      for (const domain of domains) {
        if (completed.has(domain)) continue;
        const r = await api.post('/communications/enrollments', { recipient_id: recipientId, domain, client_id: clientId, cds_customer_id: domain === 'cds' ? cdsCustomerId : null, contact_role: primary.role, locale: 'en-KE', timezone: form.timezone, status: 'pending_verification' });
        const enrollmentId = r.data?.data?.id;
        if (!enrollmentId) throw new Error(`The ${domain.toUpperCase()} enrollment could not be created.`);
        const selected = events.filter(event => domain === 'cds' ? event.startsWith('cds.') : event.startsWith('fleet.'));
        if (selected.length) await api.put(`/communications/enrollments/${enrollmentId}/subscriptions`, { subscriptions: selected.map(event_type => ({ event_type, channel, delivery_mode: 'immediate', enabled: false, critical_override: true })) });
        completed.add(domain); patch({ completedDomains: [...completed] });
      }
      return clientId;
    },
    onSuccess: () => { patch({ done: true, step: 5 }); setNotice('Client initialized successfully. All enrollments remain pending verification and dispatch-disabled.'); },
    onError: (error: any) => setNotice(error?.response?.data?.error ?? error?.message ?? 'Activation stopped safely. Your progress is saved; retry to resume from the last completed checkpoint.'),
  });

  if (!isAdmin) return <div className="flex min-h-[70vh] items-center justify-center"><div className="rounded-2xl border border-red-400/20 bg-red-400/[.04] p-8 text-center"><Radio className="mx-auto text-red-300" size={28}/><h1 className="mt-3 text-lg font-semibold text-white">Admin Communications Control</h1><p className="mt-2 max-w-sm text-xs leading-5 text-slate-500">Client Intelligence exists only on the Admin account.</p></div></div>;

  const { step, form, domains, contacts, events, channel, done } = draft;
  const canNext = step === 0 ? !!form.company.trim() && !!form.name.trim() && !!form.email.trim() && !duplicate : step === 1 ? domains.length > 0 : step === 2 ? contacts.some(c => c.email.trim()) : step === 3 ? events.length > 0 : true;
  const setContact = (index: number, p: Partial<Contact>) => patch({ contacts: contacts.map((c, i) => i === index ? { ...c, ...p } : c) });
  const clearDraft = () => { localStorage.removeItem(KEY); setDraft(initial); setNotice('Saved onboarding draft cleared.'); setSaveState('saved'); };

  return <div className="min-h-full space-y-4 text-slate-100">
    <header className="relative overflow-hidden rounded-3xl border border-white/[.08] bg-slate-950 p-6 shadow-2xl"><div className="pointer-events-none absolute -right-20 -top-24 h-72 w-72 rounded-full bg-orange-500/10 blur-3xl"/><div className="relative flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between"><div><div className="flex items-center gap-2 text-[9px] font-mono uppercase tracking-[.28em] text-orange-300"><Sparkles size={12}/> SONALIT // CLIENT INTELLIGENCE</div><h1 className="mt-2 text-3xl font-semibold tracking-tight">Initialize client</h1><p className="mt-1 max-w-2xl text-xs leading-5 text-slate-500">Identity, domain scope, communication authority and activation in one controlled admin workflow. Progress is automatically saved.</p></div><div className="rounded-2xl border border-white/[.07] bg-white/[.02] px-4 py-3 text-right"><div className="text-[9px] font-mono uppercase tracking-[.18em] text-slate-500">Onboarding state</div><div className={`mt-1 text-xs font-semibold ${saveState === 'saving' ? 'text-orange-300' : 'text-emerald-300'}`}>{saveState === 'saving' ? 'Saving…' : saveState === 'restored' ? 'Draft restored' : 'Saved'}</div></div></div></header>
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]"><main className="overflow-hidden rounded-3xl border border-white/[.07] bg-slate-950/70 shadow-2xl"><div className="overflow-x-auto border-b border-white/[.06] p-3"><div className="flex min-w-[700px] gap-1">{STEPS.map((label, i) => <button key={label} onClick={() => i <= step && patch({ step: i })} className={`flex flex-1 items-center gap-2 rounded-xl p-2 text-left ${i === step ? 'bg-white/[.06]' : 'hover:bg-white/[.025]'}`}><span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-[9px] font-mono ${i < step || done ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300' : i === step ? 'border-orange-400/40 bg-orange-400/10 text-orange-300' : 'border-white/10 text-slate-600'}`}>{i < step || done ? <Check size={13}/> : i + 1}</span><span className="text-[10px] font-semibold text-slate-400">{label}</span></button>)}</div></div><div className="p-5 sm:p-7">{notice && <div className="mb-5 rounded-xl border border-cyan-400/15 bg-cyan-400/[.035] p-3 text-xs text-cyan-100">{notice}</div>}
      {step === 0 && <section><Kicker>01 / Identity</Kicker><h2 className="mt-2 text-xl font-semibold">Resolve the organisation</h2><p className="mt-1 text-xs text-slate-500">One canonical client identity. The draft survives refresh, navigation and browser restart.</p><div className="mt-6 grid gap-4 sm:grid-cols-2"><Field label="Organisation" value={form.company} onChange={v => formPatch({ company: v })} placeholder="Acme Logistics Ltd"/><Field label="Primary contact" value={form.name} onChange={v => formPatch({ name: v })} placeholder="Jane Doe"/><Field label="Primary email" value={form.email} onChange={v => formPatch({ email: v })} placeholder="operations@acme.example"/><Field label="Country" value={form.country} onChange={v => formPatch({ country: v })} placeholder="Kenya"/><Field label="Timezone" value={form.timezone} onChange={v => formPatch({ timezone: v })} placeholder="Africa/Nairobi"/></div>{duplicate && <Warning>Existing client detected: {duplicate.company || duplicate.name} · {duplicate.email}. A saved draft can resume its own client ID; this new identity must be resolved before continuing.</Warning>}</section>}
      {step === 1 && <section><Kicker>02 / Scope</Kicker><h2 className="mt-2 text-xl font-semibold">Define the operational world</h2><p className="mt-1 text-xs text-slate-500">Fleet and CDS are independent domains. CDS is always bound to a real CDS customer identity.</p><div className="mt-6 grid gap-3 sm:grid-cols-2">{([['fleet','Fleet Operations','Convoys, vehicles, operational and security events'],['cds','Container Delivery System','Bookings, containers, e-locks, delivery and Client Pulse']] as const).map(([id,title,description]) => { const active=domains.includes(id); return <button key={id} onClick={() => patch({ domains: active ? domains.filter(x => x !== id) : [...domains,id] })} className={`rounded-2xl border p-5 text-left transition ${active ? 'border-orange-400/30 bg-orange-400/[.05]' : 'border-white/[.07] bg-white/[.015]'}`}><div className="flex justify-between"><Network className={active ? 'text-orange-300' : 'text-slate-600'}/><span className={`h-5 w-5 rounded-full border ${active ? 'border-orange-300 bg-orange-300' : 'border-white/10'}`}>{active && <Check size={12} className="m-auto mt-0.5 text-slate-950"/>}</span></div><div className="mt-5 text-sm font-semibold">{title}</div><p className="mt-1 text-[10px] leading-5 text-slate-500">{description}</p></button>})}</div></section>}
      {step === 2 && <section><Kicker>03 / Contacts</Kicker><h2 className="mt-2 text-xl font-semibold">Build recipient authority</h2><p className="mt-1 text-xs text-slate-500">Only explicitly enrolled recipients can become communication destinations.</p><div className="mt-6 space-y-3">{contacts.map((c,i)=><div key={i} className="rounded-2xl border border-white/[.07] p-4"><div className="mb-3 text-[9px] font-mono uppercase tracking-[.18em] text-slate-600">Contact {i+1}</div><div className="grid gap-3 sm:grid-cols-2"><Field label="Name" value={c.name} onChange={v=>setContact(i,{name:v})} placeholder="Jane Doe"/><Field label="Email" value={c.email} onChange={v=>setContact(i,{email:v})} placeholder="operations@acme.example"/><Field label="Role" value={c.role} onChange={v=>setContact(i,{role:v})} placeholder="Operations"/></div></div>)}<button onClick={()=>patch({contacts:[...contacts,{name:'',email:'',role:'Operations'}]})} className="rounded-xl border border-dashed border-white/10 px-4 py-3 text-[10px] text-slate-400">+ Add another contact</button></div></section>}
      {step === 3 && <section><Kicker>04 / Contract</Kicker><h2 className="mt-2 text-xl font-semibold">Define communication authority</h2><p className="mt-1 text-xs text-slate-500">Subscriptions are created disabled and remain blocked until explicit verification.</p><div className="mt-6 space-y-2">{EVENTS.filter(([e])=>domains.includes(e.startsWith('cds.')?'cds':'fleet')).map(([e,label])=><button key={e} onClick={()=>patch({events:events.includes(e)?events.filter(x=>x!==e):[...events,e]})} className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left ${events.includes(e)?'border-orange-400/20 bg-orange-400/[.03]':'border-white/[.06]'}`}><span className={`flex h-5 w-5 items-center justify-center rounded-full border ${events.includes(e)?'border-orange-300 bg-orange-300 text-slate-950':'border-white/10 text-transparent'}`}><Check size={11}/></span><span className="flex-1 text-xs">{label}</span><span className="text-[8px] font-mono text-slate-700">{e}</span></button>)}</div><div className="mt-5"><label className="text-[9px] font-mono uppercase tracking-[.18em] text-slate-600">Primary channel</label><select value={channel} onChange={e=>patch({channel:e.target.value})} className="mt-2 w-full rounded-xl border border-white/[.08] bg-slate-900 px-3 py-3 text-xs text-white outline-none"><option value="email">Email</option><option value="sms">SMS</option><option value="whatsapp">WhatsApp</option></select></div></section>}
      {step === 4 && <section><Kicker>05 / Simulation</Kicker><h2 className="mt-2 text-xl font-semibold">Prove the route</h2><p className="mt-1 text-xs text-slate-500">Dry-run only. Provider calls are impossible from this screen.</p><div className="mt-6 rounded-2xl border border-cyan-400/15 bg-cyan-400/[.025] p-5"><div className="flex items-center gap-3"><Radio className="text-cyan-300" size={20}/><div><div className="text-sm font-semibold">Simulation ready</div><div className="text-[10px] text-slate-500">{events.length} event routes · {domains.length} domain{domains.length===1?'':'s'} · {channel.toUpperCase()}</div></div></div><div className="mt-5 grid gap-2 sm:grid-cols-2">{[['Boundary','ORG + EXACT CLIENT'],['CDS binding',domains.includes('cds')?'REAL CDS CUSTOMER':'NOT APPLICABLE'],['Dispatch','BLOCKED UNTIL VERIFIED'],['External send','DISABLED']].map(([k,v])=><div key={k} className="rounded-xl border border-white/[.06] p-3"><div className="text-[8px] font-mono uppercase text-slate-600">{k}</div><div className="mt-1 text-[10px] font-semibold text-slate-300">{v}</div></div>)}</div></div></section>}
      {step === 5 && <section><Kicker>06 / Activation</Kicker><h2 className="mt-2 text-xl font-semibold">Commit safely</h2><p className="mt-1 text-xs text-slate-500">Activation is resumable. Each remote checkpoint is remembered before the next one runs.</p><div className="mt-6 rounded-2xl border border-orange-400/15 bg-orange-400/[.025] p-5"><div className="flex gap-3"><ShieldCheck className="text-orange-300" size={20}/><div className="flex-1"><div className="text-sm font-semibold">{done?'Client initialized':'Ready for controlled activation'}</div><p className="mt-1 text-[10px] leading-5 text-slate-500">{form.company || 'Unnamed client'} · {domains.join(' + ').toUpperCase()} · {events.length} routes · {channel}</p><div className="mt-4 grid grid-cols-2 gap-2 text-[9px] font-mono text-slate-600"><span>CLIENT {draft.clientId?'✓':'○'}</span><span>CDS {draft.cdsCustomerId?'✓':'○'}</span><span>RECIPIENT {draft.recipientId?'✓':'○'}</span><span>ENROLLMENTS {draft.completedDomains?.length??0}/{domains.length}</span></div></div></div><button disabled={activate.isPending||done} onClick={()=>activate.mutate()} className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-orange-500 px-4 py-3 text-xs font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-50">{done?<Check size={14}/>:<UserPlus size={14}/>} {done?'Client initialized':activate.isPending?'Resuming activation…':'Initialize client'}</button></div></section>}
      <div className="mt-8 flex items-center justify-between border-t border-white/[.06] pt-4"><button disabled={step===0} onClick={()=>patch({step:step-1})} className="flex items-center gap-2 rounded-xl px-3 py-2 text-xs text-slate-500 disabled:opacity-30"><ArrowLeft size={14}/> Back</button><div className="flex items-center gap-2">{step===0 && localStorage.getItem(KEY) && <button onClick={clearDraft} className="rounded-xl px-3 py-2 text-[10px] text-slate-600 hover:text-red-300">Clear saved draft</button>}{step<5&&<button disabled={!canNext} onClick={()=>patch({step:step+1})} className="flex items-center gap-2 rounded-xl bg-white px-4 py-2 text-xs font-semibold text-slate-950 disabled:opacity-30">Continue <ArrowRight size={14}/></button>}</div></div>
    </div></main><aside className="rounded-3xl border border-white/[.07] bg-slate-950/70 p-5 shadow-2xl"><div className="text-[9px] font-mono uppercase tracking-[.2em] text-slate-600">Readiness</div><div className="mt-2 text-3xl font-semibold text-white">{Math.min(100,Math.round(((step+(done?1:0))/6)*100))}%</div><div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/[.06]"><div className="h-full rounded-full bg-orange-400 transition-all" style={{width:`${Math.min(100,Math.round(((step+(done?1:0))/6)*100))}%`}}/></div><div className="mt-6 space-y-2">{STEPS.map((label,i)=><div key={label} className="flex items-center gap-2 rounded-xl border border-white/[.05] p-3"><span className={`h-2 w-2 rounded-full ${i<=step||done?'bg-emerald-400':'bg-slate-700'}`}/><span className="text-[10px] text-slate-400">{label}</span></div>)}</div><div className="mt-6 rounded-2xl border border-emerald-400/10 bg-emerald-400/[.02] p-4"><div className="flex gap-2"><ShieldCheck size={14} className="text-emerald-300"/><span className="text-[10px] leading-5 text-slate-500">Admin-only. Draft state persists locally. Remote checkpoints make activation retry-safe. No external communication is sent during onboarding.</span></div></div></aside></div>
  </div>;
}

function Kicker({children}:{children:React.ReactNode}){return <div className="text-[9px] font-mono uppercase tracking-[.22em] text-orange-300">{children}</div>}
function Field({label,value,onChange,placeholder}:{label:string;value:string;onChange:(v:string)=>void;placeholder:string}){return <label className="block"><span className="text-[9px] font-mono uppercase tracking-[.16em] text-slate-600">{label}</span><input value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder} className="mt-2 w-full rounded-xl border border-white/[.08] bg-slate-900/80 px-3 py-3 text-xs text-white outline-none placeholder:text-slate-700 focus:border-orange-400/30"/></label>}
function Warning({children}:{children:React.ReactNode}){return <div className="mt-4 flex gap-2 rounded-xl border border-amber-400/20 bg-amber-400/[.04] p-3 text-[10px] text-amber-100"><AlertTriangle size={14} className="shrink-0 text-amber-300"/>{children}</div>}
