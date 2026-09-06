import { useState } from 'react';
import { Radio, UserPlus } from 'lucide-react';
import CommunicationsControlPlane from './CommunicationsControlPlane';
import ClientOnboarding from './ClientOnboardingV3';
import { useAuthStore } from '../stores/auth.js';

export default function Communications() {
  const isAdmin = useAuthStore(s => s.user?.role === 'admin');
  const [view, setView] = useState<'control' | 'onboarding'>('control');

  if (!isAdmin) {
    return <div className="flex min-h-[70vh] items-center justify-center"><div className="rounded-2xl border border-red-400/20 bg-red-400/[.04] p-8 text-center"><Radio className="mx-auto text-red-300" size={28}/><h1 className="mt-3 text-lg font-semibold text-white">Admin Communications Control</h1><p className="mt-2 max-w-sm text-xs leading-5 text-slate-500">Communications exists only on the Admin account. This control plane is intentionally unavailable to other roles.</p></div></div>;
  }

  return <div className="space-y-3"><div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/[.07] bg-slate-950/70 p-2"><div className="flex items-center gap-1"><button onClick={() => setView('control')} className={`rounded-xl px-4 py-2 text-xs font-semibold transition ${view === 'control' ? 'bg-white/10 text-white' : 'text-slate-500 hover:text-white'}`}><Radio size={13} className="mr-2 inline"/>Command</button><button onClick={() => setView('onboarding')} className={`rounded-xl px-4 py-2 text-xs font-semibold transition ${view === 'onboarding' ? 'bg-orange-500/10 text-orange-200' : 'text-slate-500 hover:text-white'}`}><UserPlus size={13} className="mr-2 inline"/>Client Intelligence</button></div><div className="px-3 text-[9px] font-mono uppercase tracking-[.18em] text-slate-600">ADMIN ONLY · COMMUNICATIONS CONTROL PLANE</div></div>{view === 'control' ? <CommunicationsControlPlane/> : <ClientOnboarding/>}</div>;
}
