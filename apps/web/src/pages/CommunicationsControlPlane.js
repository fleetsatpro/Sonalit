import { useState } from 'react';
import { FileText, Radio, Shield, Users } from 'lucide-react';
import Communications from './Communications.jsx';
import ClientPulseSettingsView from './cds/ClientPulseSettings.js';
import CommunicationsAuthorityV2 from './CommunicationsAuthorityV2.js';
import CommunicationsPublications from './CommunicationsPublications.jsx';

export default function CommunicationsControlPlane(){
  const [view,setView]=useState('publications');
  const nav=[['publications',FileText,'Publications'],['distribution',Users,'Distribution'],['pulse',Radio,'Client Pulse'],['authority',Shield,'Authority']];
  return <div className="min-h-full bg-[#05080d] text-slate-200">
    <div className="sticky top-0 z-40 border-b border-white/[.07] bg-[#070b11]/95 px-4 py-3 backdrop-blur-xl sm:px-6">
      <div className="mx-auto flex max-w-[1680px] flex-wrap items-center gap-2">
        <div className="mr-3 flex items-center gap-2 pr-3 text-[10px] font-bold uppercase tracking-[.28em] text-slate-500"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400"/> Communications Centre</div>
        {nav.map(([id,Icon,label])=><button key={id} onClick={()=>setView(id)} className={`inline-flex items-center gap-2 rounded-xl px-3.5 py-2.5 text-xs font-semibold transition ${view===id?'bg-white/[.08] text-white shadow-inner':'text-slate-500 hover:bg-white/[.035] hover:text-slate-300'}`}><Icon size={14}/>{label}</button>)}
      </div>
    </div>
    <div className="mx-auto max-w-[1680px] px-3 py-4 sm:px-6 sm:py-6">
      {view==='publications'&&<CommunicationsPublications/>}
      {view==='distribution'&&<Communications/>}
      {view==='pulse'&&<ClientPulseSettingsView/>}
      {view==='authority'&&<CommunicationsAuthorityV2/>}
    </div>
  </div>;
}
