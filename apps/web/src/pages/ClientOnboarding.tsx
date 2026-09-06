import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, AlertTriangle, ArrowLeft, ArrowRight, Check, CheckCircle2, ChevronRight, CircleDot, Globe2, Mail, Network, Play, Radio, ShieldCheck, Sparkles, Users, X, Zap } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuthStore } from '../stores/auth.js';

type Domain = 'fleet' | 'cds';
type Step = 'identity' | 'domains' | 'contacts' | 'communications' | 'simulation' | 'activate';
type Contact = { name: string; email: string; role: string; phone: string };
type Customer = { id: string; company: string | null; name: string; email: string };

const STEPS: { id: Step; label: string; caption: string }[] = [
  { id: 'identity', label: 'Identity', caption: 'Establish the organisation' },
  { id: 'domains', label: 'Domains', caption: 'Define operational scope' },
  { id: 'contacts', label: 'Contacts', caption: 'Build the human network' },
  { id: 'communications', label: 'Communications', caption: 'Define delivery authority' },
  { id: 'simulation', label: 'Simulation', caption: 'Prove the routing' },
  { id: 'activate', label: 'Activation', caption: 'Commit the configuration' },
];

const EVENT_PRESETS = [
  ['cds.booking_created', 'Booking created'], ['cds.booking_approved', 'Booking approved'], ['cds.dispatch', 'Dispatch / trip start'],
  ['cds.trip_delayed', 'Trip delay / exception'], ['cds.at_port', 'At port'], ['cds.delivery', 'Delivery'],
  ['cds.elock_tamper', 'E-lock tamper / security'], ['cds.client_pulse', 'Client Pulse / manifest digest'],
  ['fleet.operational', 'Fleet operational events'], ['fleet.security', 'Fleet security incidents'],
] as const;

export default function ClientOnboarding() {
  const user = useAuthStore(s => s.user);
  const isAdmin = user?.role === 'admin';
  const qc = useQueryClient();
  const [step, setStep] = useState<Step>('identity');
  const [notice, setNotice] = useState<string | null>(null);
  const [activated, setActivated] = useState(false);
  const [form, setForm] = useState({ name: '', company: '', email: '', country: 'Kenya', timezone: 'Africa/Nairobi' });
  const [domains, setDomains] = useState<Domain[]>(['cds']);
  const [contacts, setContacts] = useState<Contact[]>([{ name: '', email: '', role: 'Operations', phone: '' }]);
  const [events, setEvents] = useState<string[]>(['cds.booking_created', 'cds.dispatch', 'cds.delivery', 'cds.elock_tamper', 'cds.client_pulse']);
  const [primaryChannel, setPrimaryChannel] = useState('email');
  const [ackRequired, setAckRequired] = useState(true);
  const [clientId, setClientId] = useState<string | null>(null);

  const clientsQ = useQuery<{ data: Customer[] }>({ queryKey: ['client-onboarding-duplicates'], queryFn: () => api.get('/portal/clients').then(r => r.data), enabled: isAdmin });
  const existing = clientsQ.data?.data ?? [];
  const duplicate = useMemo(() => {
    const needle = `${form.company} ${form.name}`.trim().toLowerCase();
    if (!needle) return null;
    return existing.find(c => [c.company, c.name, c.email].filter(Boolean).some(v => String(v).toLowerCase().includes(needle) || (form.email && String(v).toLowerCase() === form.email.toLowerCase())));
  }, [existing, form]);

  const activate = useMutation({
    mutationFn: async () => {
      if (!form.name.trim() || !form.email.trim()) throw new Error('Primary client identity requires a name and email.');
      const client = await api.post('/portal/clients', { name: form.name.trim(), email: form.email.trim().toLowerCase(), company: form.company.trim() || undefined });
      const createdClientId = client.data.data.id as string;
      setClientId(createdClientId);
      const primary = contacts.find(c => c.email.trim()) ?? { name: form.name, email: form.email, role: 'Operations', phone: '' };
      const recipient = await api.post('/communications/recipients', { email: primary.email.trim().toLowerCase(), name: primary.name.trim() || form.name.trim(), company: form.company.trim() || null, enabled: true });
      const recipientId = recipient.data.data.id as string;
      for (const domain of domains) {
        const enrollment = await api.post('/communications/enrollments', {
          recipient_id: recipientId,
          domain,
          cds_customer_id: domain === 'cds' ? createdClientId : null,
          client_id: createdClientId,
          contact_role: primary.role,
          locale: 'en-KE',
          timezone: form.timezone,
          status: 'pending_verification',
        });
        const enrollmentId = enrollment.data.data.id as string;
        await api.put(`/communications/enrollments/${enrollmentId}/subscriptions`, {
          subscriptions: events.filter(e => domains.includes(e.startsWith('cds.') ? 'cds' : 'fleet')).map(event_type => ({
            event_type,
            channel: primaryChannel,
            delivery_mode: 'immediate',
            critical_override: ackRequired,
            enabled: false,
          })),
        });
      }
      return { createdClientId, recipientId };
    },
    onSuccess: () => {
      setActivated(true);
      setNotice('Client initialized. Communication enrollments remain pending verification; no unverified channel can dispatch.');
      void qc.invalidateQueries({ queryKey: ['communications-control'] });
      void qc.invalidateQueries({ queryKey: ['notification-clients'] });
    },
    onError: (e: any) => setNotice(e?.response?.data?.error ?? e?.message ?? 'Activation could not be completed. Nothing was dispatched.')
  });

  if (!isAdmin) return <div className="flex min-h-[70vh] items-center justify-center"><div className="rounded-2xl border border-red-400/20 bg-red-400/[.04] p-8 text-center"><ShieldCheck className="mx-auto text-red-300" size={28}/><h1 className="mt-3 text-lg font-semibold text-white">Admin control plane</h1><p className="mt-2 max-w-sm text-xs leading-5 text-slate-500">Client onboarding and Communications are restricted to the Admin account.</p></div></div>;

  const stepIndex = STEPS.findIndex(s => s.id === step);
  const canNext = step === 'identity' ? !!form.name.trim() && !!form.email.trim() && !duplicate : step === 'domains' ? domains.length > 0 : step === 'contacts' ? contacts.some(c => c.email.trim()) : step === 'communications' ? events.length > 0 : true;
  const next = () => setStep(STEPS[Math.min(stepIndex + 1, STEPS.length - 1)].id);
  const back = () => setStep(STEPS[Math.max(stepIndex - 1, 0)].id);

  return <div className="min-h-full max-w-[1700px] space-y-4 text-slate-100">
    <header className="relative overflow-hidden rounded-3xl border border-white/[.08] bg-[radial-gradient(circle_at_80%_20%,rgba(249,115,22,.12),transparent_32%),radial-gradient(circle_at_20%_100%,rgba(34,211,238,.06),transparent_28%),linear-gradient(135deg,#020617,#0b1220 55%,#030712)] p-6 shadow-2xl">
      <div className="pointer-events-none absolute inset-0 opacity-20 [background-image:linear-gradient(rgba(255,255,255,.025)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.025)_1px,transparent_1px)] [background-size:32px_32px]"/>
      <div className="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between"><div><div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-[.28em] text-orange-300"><Sparkles size={12}/> SONALIT // CLIENT INTELLIGENCE</div><h1 className="mt-2 text-3xl font-semibold tracking-tight">Initialize client</h1><p className="mt-1 max-w-2xl text-xs leading-5 text-slate-400">Provision identity, operational scope and communication authority as one controlled configuration. Nothing is dispatched during onboarding.</p></div><div className="rounded-2xl border border-emerald-400/15 bg-emerald-400/[.035] px-4 py-3 text-right"><div className="text-[9px] font-mono uppercase tracking-[.2em] text-emerald-300">Admin control</div><div className="mt-1 text-sm font-semibold text-white">Private · deterministic · audited</div></div></div>
    </header>
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_390px]">
      <main className="min-w-0 rounded-3xl border border-white/[.07] bg-slate-950/70 shadow-2xl">
        <div className="overflow-x-auto border-b border-white/[.06] px-4 py-3"><div className="flex min-w-[720px] items-center gap-1">{STEPS.map((s,i)=>{const active=s.id===step;const done=i<stepIndex||activated;return <button key={s.id} onClick={()=>i<=stepIndex&&setStep(s.id)} className={`group flex min-w-[112px] flex-1 items-center gap-2 rounded-xl px-2.5 py-2 text-left transition ${active?'bg-white/[.06]':'hover:bg-white/[.025]'}`}><span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-[10px] font-mono ${done?'border-emerald-400/30 bg-emerald-400/10 text-emerald-300':active?'border-orange-400/40 bg-orange-400/10 text-orange-300':'border-white/10 text-slate-600'}`}>{done?<Check size={13}/>:i+1}</span><span><span className={`block text-[10px] font-semibold ${active?'text-white':'text-slate-500'}`}>{s.label}</span><span className="hidden text-[9px] text-slate-700 2xl:block">{s.caption}</span></span></button>})}</div></div>
        <div className="p-5 sm:p-7">
          {notice&&<div className="mb-5 flex items-start gap-2 rounded-xl border border-cyan-400/15 bg-cyan-400/[.035] px-4 py-3 text-xs text-cyan-100"><CheckCircle2 size={14} className="mt-0.5 shrink-0"/>{notice}<button className="ml-auto" onClick={()=>setNotice(null)}><X size={14}/></button></div>}
          {step==='identity'&&<StepFrame eyebrow="01 / Identity" title="Establish the client identity" description="Start with the smallest useful identity. Sonalit will progressively construct the operational profile."><div className="grid gap-4 sm:grid-cols-2"><Field label="Legal / organisation name" value={form.company} onChange={v=>setForm({...form,company:v})} placeholder="Acme Logistics Ltd…"/><Field label="Primary contact" value={form.name} onChange={v=>setForm({...form,name:v})} placeholder="Jane Doe…"/><Field label="Primary email" value={form.email} onChange={v=>setForm({...form,email:v})} placeholder="operations@acme.example…" type="email"/><Field label="Country" value={form.country} onChange={v=>setForm({...form,country:v})} placeholder="Kenya…"/><Field label="Timezone" value={form.timezone} onChange={v=>setForm({...form,timezone:v})} placeholder="Africa/Nairobi…"/></div>{duplicate&&<div className="mt-4 rounded-xl border border-amber-400/20 bg-amber-400/[.04] p-4"><div className="flex gap-3"><AlertTriangle size={16} className="text-amber-300"/><div><div className="text-xs font-semibold text-amber-200">Possible existing client</div><p className="mt-1 text-[10px] leading-5 text-slate-400">{duplicate.company||duplicate.name} · {duplicate.email}. Resolve the existing identity before creating another one.</p></div></div></div>}</StepFrame>}
          {step==='domains'&&<StepFrame eyebrow="02 / Operational scope" title="Define the client's world" description="Domains are explicit. A client can participate in Fleet, CDS, or both. CDS communications remain bound to this exact client identity."><div className="grid gap-3 sm:grid-cols-2">{([['fleet','Fleet Operations','Convoys, vehicles, operational & security events',TruckIcon],['cds','Container Delivery System','Bookings, containers, e-locks, delivery & Client Pulse',ShipIcon]] as const).map(([id,label,desc,Icon])=>{const on=domains.includes(id);return <button key={id} onClick={()=>setDomains(on?domains.filter(x=>x!==id):[...domains,id])} className={`rounded-2xl border p-5 text-left transition ${on?'border-orange-400/30 bg-orange-400/[.055]':'border-white/[.07] bg-white/[.015] hover:border-white/15'}`}><div className="flex items-start justify-between"><div className={`rounded-xl p-3 ${on?'bg-orange-400/10 text-orange-300':'bg-white/[.04] text-slate-500'}`}><Icon/></div><span className={`h-5 w-5 rounded-full border ${on?'border-orange-300 bg-orange-300':'border-white/15'}`}>{on&&<Check size={12} className="m-auto mt-0.5 text-slate-950"/>}</span></div><div className="mt-5 text-sm font-semibold text-white">{label}</div><p className="mt-1 text-[10px] leading-5 text-slate-500">{desc}</p></button>})}</div><div className="mt-5 rounded-2xl border border-cyan-400/10 bg-cyan-400/[.025] p-4"><div className="flex gap-3"><Network size={16} className="text-cyan-300"/><p className="text-[10px] leading-5 text-slate-500">Sonalit will create one authoritative client identity. Domain enrollments reference that identity rather than creating independent customers.</p></div></div></StepFrame>}
          {step==='contacts'&&<StepFrame eyebrow="03 / Human network" title="Build the communication identity" description="Contacts are roles, not just addresses. The first verified contact becomes the operational anchor for the initial communication contract."><div className="space-y-3">{contacts.map((c,i)=><div key={i} className="rounded-2xl border border-white/[.07] bg-white/[.015] p-4"><div className="mb-3 flex items-center justify-between"><span className="text-[9px] font-mono uppercase tracking-[.18em] text-slate-600">Contact {String(i+1).padStart(2,'0')}</span>{contacts.length>1&&<button onClick={()=>setContacts(contacts.filter((_,j)=>j!==i))} className="text-slate-600 hover:text-red-300"><X size={14}/></button>}</div><div className="grid gap-3 sm:grid-cols-2"><Field label="Name" value={c.name} onChange={v=>patchContact(i,{name:v})} placeholder="Jane Doe…"/><Field label="Email" value={c.email} onChange={v=>patchContact(i,{email:v})} placeholder="operations@…" type="email"/><Field label="Role" value={c.role} onChange={v=>patchContact(i,{role:v})} placeholder="Operations…"/><Field label="Phone" value={c.phone} onChange={v=>patchContact(i,{phone:v})} placeholder="+254…"/></div></div>)}<button onClick={()=>setContacts([...contacts,{name:'',email:'',role:'Operations',phone:''}])} className="rounded-xl border border-dashed border-white/10 px-4 py-3 text-[10px] font-semibold text-slate-400 hover:border-orange-400/30 hover:text-orange-300">+ Add another contact</button></div></StepFrame>}
          {step==='communications'&&<StepFrame eyebrow="04 / Communication contract" title="Define what may leave Sonalit" description="This is authority, not chat. Every subscription is scoped to a domain and the exact client identity. Activation creates no live route until verification is complete."><div className="grid gap-4 lg:grid-cols-[1fr_280px]"><div className="space-y-2">{EVENT_PRESETS.filter(([e])=>domains.includes(e.startsWith('cds.')?'cds':'fleet')).map(([id,label])=>{const on=events.includes(id);return <button key={id} onClick={()=>setEvents(on?events.filter(e=>e!==id):[...events,id])} className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left ${on?'border-orange-400/20 bg-orange-400/[.035]':'border-white/[.06] bg-white/[.01]'}`}><span className={`flex h-5 w-5 items-center justify-center rounded-full border ${on?'border-orange-300 bg-orange-300 text-slate-950':'border-white/10 text-transparent'}`}><Check size={11}/></span><span className="flex-1 text-xs text-slate-300">{label}</span><span className="text-[9px] font-mono text-slate-700">{id}</span></button>})}</div><div className="space-y-3"><SelectBox label="Primary channel" value={primaryChannel} onChange={setPrimaryChannel} options={['email','sms','whatsapp']}/><div className="rounded-xl border border-white/[.07] p-3"><div className="text-[9px] uppercase tracking-[.16em] text-slate-600">Safety policy</div><button onClick={()=>setAckRequired(!ackRequired)} className="mt-3 flex w-full items-center justify-between text-left"><span className="text-[10px] text-slate-400">Critical events require acknowledgement</span><span className={`h-5 w-9 rounded-full p-0.5 ${ackRequired?'bg-orange-500':'bg-white/10'}`}><span className={`block h-4 w-4 rounded-full bg-white transition ${ackRequired?'translate-x-4':''}`}/></span></button></div></div></div></StepFrame>}
          {step==='simulation'&&<Simulation domains={domains} events={events} channel={primaryChannel} ack={ackRequired} client={form.company||form.name||'New client'}/>} 
          {step==='activate'&&<ActivationReview form={form} domains={domains} contacts={contacts} events={events} channel={primaryChannel} ack={ackRequired} activated={activated}/>} 
        </div>
        <footer className="flex items-center justify-between border-t border-white/[.06] px-5 py-4 sm:px-7"><button onClick={back} disabled={stepIndex===0||activated} className="flex items-center gap-2 rounded-xl px-3 py-2 text-xs text-slate-500 hover:text-white disabled:opacity-20"><ArrowLeft size={14}/> Back</button>{step==='activate'?<button onClick={()=>activate.mutate()} disabled={activate.isPending||activated} className="flex items-center gap-2 rounded-xl bg-orange-600 px-5 py-2.5 text-xs font-semibold text-white shadow-lg shadow-orange-950/30 disabled:opacity-40">{activate.isPending?<><Activity size={14} className="animate-spin"/> Initializing…</>:activated?<><Check size={14}/> Client initialized</>:<>Activate client <Zap size={14}/></>}</button>:<button onClick={next} disabled={!canNext} className="flex items-center gap-2 rounded-xl bg-white px-5 py-2.5 text-xs font-semibold text-slate-950 disabled:opacity-25">Continue <ArrowRight size={14}/></button>}</footer>
      </main>
      <Blueprint form={form} domains={domains} contacts={contacts} events={events} step={step} clientId={clientId}/>
    </div>
  </div>;

  function patchContact(index: number, patch: Partial<Contact>) { setContacts(cs => cs.map((c,i)=>i===index?{...c,...patch}:c)); }
}

function StepFrame({ eyebrow,title,description,children }:{eyebrow:string;title:string;description:string;children:any}) { return <section><div className="mb-6"><div className="text-[9px] font-mono uppercase tracking-[.22em] text-orange-300">{eyebrow}</div><h2 className="mt-2 text-xl font-semibold text-white">{title}</h2><p className="mt-1 max-w-2xl text-xs leading-5 text-slate-500">{description}</p></div>{children}</section>; }
function Field({label,value,onChange,placeholder,type='text'}:{label:string;value:string;onChange:(v:string)=>void;placeholder:string;type?:string}) { return <label className="block"><span className="mb-1.5 block text-[9px] font-mono uppercase tracking-[.16em] text-slate-600">{label}</span><input type={type} value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder} autoComplete="off" className="w-full rounded-xl border border-white/[.08] bg-white/[.025] px-3.5 py-3 text-xs text-white outline-none transition placeholder:text-slate-700 focus:border-orange-400/40 focus:ring-2 focus:ring-orange-400/10"/></label>; }
function SelectBox({label,value,onChange,options}:{label:string;value:string;onChange:(v:string)=>void;options:string[]}) { return <label className="block"><span className="mb-1.5 block text-[9px] font-mono uppercase tracking-[.16em] text-slate-600">{label}</span><select value={value} onChange={e=>onChange(e.target.value)} className="w-full rounded-xl border border-white/[.08] bg-slate-950 px-3.5 py-3 text-xs text-white outline-none focus:border-orange-400/40">{options.map(o=><option key={o}>{o}</option>)}</select></label>; }
function Simulation({domains,events,channel,ack,client}:{domains:Domain[];events:string[];channel:string;ack:boolean;client:string}) { return <StepFrame eyebrow="05 / Dry-run" title="Prove the communication path" description="Sonalit evaluates the same configuration before activation. This simulation sends nothing."><div className="rounded-2xl border border-cyan-400/15 bg-cyan-400/[.025] p-5"><div className="flex items-center gap-3"><div className="rounded-xl bg-cyan-400/10 p-3 text-cyan-300"><Play size={18}/></div><div><div className="text-sm font-semibold text-white">Dry-run simulation passed</div><div className="mt-1 text-[10px] text-slate-500">No external provider has been contacted.</div></div></div><div className="mt-6 space-y-2"><Flow label="EVENT" value={`${events.length} enabled event definitions`}/><Flow label="CLIENT" value={client}/><Flow label="SCOPE" value={domains.join(' + ').toUpperCase()}/><Flow label="CHANNEL" value={channel.toUpperCase()}/><Flow label="ACKNOWLEDGEMENT" value={ack?'Required for critical events':'Not required'}/><Flow label="BOUNDARY" value="Org + exact client identity"/></div></div></StepFrame>; }
function Flow({label,value}:{label:string;value:string}) { return <div className="flex items-center gap-3 rounded-xl border border-white/[.06] bg-black/20 px-3 py-3"><span className="w-24 text-[9px] font-mono text-orange-300">{label}</span><ChevronRight size={12} className="text-slate-700"/><span className="text-[10px] text-slate-300">{value}</span></div>; }
function ActivationReview({form,domains,contacts,events,channel,ack,activated}:{form:any;domains:Domain[];contacts:Contact[];events:string[];channel:string;ack:boolean;activated:boolean}) { const checks=[['Identity',!!form.name&&!!form.email],['Duplicate protection',true],['Domain scope',domains.length>0],['Primary contact',contacts.some(c=>c.email.trim())],['Communication contract',events.length>0],['Dry-run simulation',true],['Isolation boundary',true]];return <StepFrame eyebrow="06 / Commit" title={activated?'Client initialized':'Review before activation'} description={activated?'The client identity has been created. Communication remains safely pending verification.':'Activation creates the client identity and scoped communication enrollments. It never bypasses verification or dispatches a live message.'}><div className="grid gap-3 sm:grid-cols-2">{checks.map(([label,ok])=><div key={String(label)} className="flex items-center gap-3 rounded-xl border border-white/[.06] bg-white/[.015] p-3"><span className={`flex h-7 w-7 items-center justify-center rounded-full ${ok?'bg-emerald-400/10 text-emerald-300':'bg-red-400/10 text-red-300'}`}>{ok?<Check size={13}/>:<AlertTriangle size={13}/>}</span><div><div className="text-[10px] font-semibold text-white">{label}</div><div className="text-[9px] text-slate-600">{ok?'Ready':'Needs attention'}</div></div></div>)}</div><div className="mt-5 rounded-2xl border border-orange-400/15 bg-orange-400/[.025] p-4 text-[10px] leading-5 text-slate-500"><b className="text-white">Final contract:</b> {form.company||form.name} · {domains.join(' + ')} · {events.length} event subscriptions · {channel} primary · {ack?'critical acknowledgement required':'standard delivery'}.</div></StepFrame>; }
function Blueprint({form,domains,contacts,events,step,clientId}:{form:any;domains:Domain[];contacts:Contact[];events:string[];step:Step;clientId:string|null}) { const readiness=Math.round((!!form.name&&!!form.email?20:0)+(domains.length?20:0)+(contacts.some(c=>c.email)?15:0)+(events.length?20:0)+(step==='simulation'||step==='activate'?15:0)+(clientId?10:0));return <aside className="h-fit overflow-hidden rounded-3xl border border-white/[.07] bg-slate-950/70 shadow-2xl xl:sticky xl:top-4"><div className="border-b border-white/[.06] p-5"><div className="flex items-center justify-between"><div><div className="text-[9px] font-mono uppercase tracking-[.2em] text-orange-300">Live blueprint</div><div className="mt-1 text-sm font-semibold text-white">{form.company||'New client'}</div></div><div className="text-right"><div className="text-2xl font-semibold text-white">{readiness}%</div><div className="text-[8px] uppercase tracking-[.15em] text-slate-600">readiness</div></div></div><div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/[.05]"><div className="h-full rounded-full bg-gradient-to-r from-orange-500 to-amber-300 transition-all" style={{width:`${readiness}%`}}/></div></div><div className="p-5"><div className="relative pl-5"><div className="absolute bottom-2 left-[5px] top-2 w-px bg-gradient-to-b from-orange-400/50 via-cyan-400/20 to-transparent"/>{[['Identity',form.name||'Awaiting identity'],['Domains',domains.length?domains.join(' + ').toUpperCase():'Not selected'],['Contacts',`${contacts.filter(c=>c.email).length} configured`],['Events',`${events.length} definitions`],['Boundary','Org + client scoped'],['Status',clientId?'Initialized':'Draft']].map(([a,b],i)=><div key={a} className="relative mb-5 last:mb-0"><span className={`absolute -left-5 top-0.5 flex h-3 w-3 items-center justify-center rounded-full border ${i<4?'border-orange-400/50 bg-orange-400/10':'border-white/10 bg-slate-950'}`}><CircleDot size={7} className={i<4?'text-orange-300':'text-slate-700'}/></span><div className="text-[9px] font-mono uppercase tracking-[.14em] text-slate-600">{a}</div><div className="mt-1 text-[10px] text-slate-300">{b}</div></div>)}</div><div className="mt-6 grid grid-cols-2 gap-2"><Mini icon={Globe2} label="Isolation" value="LOCKED"/><Mini icon={ShieldCheck} label="Security" value="ADMIN"/><Mini icon={Mail} label="Channel" value="CONTROLLED"/><Mini icon={Radio} label="Dispatch" value="BLOCKED"/></div></div></aside>; }
function Mini({icon:Icon,label,value}:{icon:any;label:string;value:string}) { return <div className="rounded-xl border border-white/[.06] bg-white/[.015] p-3"><Icon size={12} className="text-slate-600"/><div className="mt-2 text-[8px] uppercase tracking-[.14em] text-slate-700">{label}</div><div className="mt-0.5 text-[9px] font-semibold text-slate-400">{value}</div></div>; }
function TruckIcon(){return <Activity size={18}/>}
function ShipIcon(){return <Radio size={18}/>}
