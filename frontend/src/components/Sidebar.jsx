import { useState } from 'react';
import { Eye, Package, Globe, ShoppingCart, BarChart2, Truck, Cpu, AlertOctagon,
  Smartphone, Users, Wifi, Camera, Shield, FileText, TrendingUp, Gavel,
  Activity, Leaf, DollarSign, PieChart, Workflow, MessageSquare, Lock,
  Map, Code, Layers, Navigation, Bot, Briefcase, Scale, CreditCard,
  Heart, ShieldCheck, Radar, ChevronDown, Search } from 'lucide-react';

const CATEGORIES = [
  { id:'visibility', label:'VISIBILITY & SUPPLY CHAIN', color:'var(--cyan)',
    modules:[
      { num:'01', label:'Supply Chain Visibility', phase:'P1', Icon:Eye },
      { num:'02', label:'Warehouse Management',    phase:'P2', Icon:Package },
      { num:'03', label:'Customs & Border Intel',  phase:'P2', Icon:Globe },
      { num:'07', label:'Digital Twin Engine',     phase:'P2', Icon:Layers },
    ]},
  { id:'fleet', label:'FLEET & FIELD ASSETS', color:'var(--amber)',
    modules:[
      { num:'10', label:'Driver Mobile App',       phase:'P1', Icon:Smartphone },
      { num:'11', label:'Contractor Portal',       phase:'P3', Icon:Users },
      { num:'12', label:'IoT Sensor Command',      phase:'P1', Icon:Wifi },
      { num:'13', label:'Computer Vision',         phase:'P4', Icon:Camera },
      { num:'28', label:'Multi-Modal Logistics',   phase:'P5', Icon:Navigation },
      { num:'29', label:'Autonomous Readiness',    phase:'P5', Icon:Bot },
    ]},
  { id:'procurement', label:'PROCUREMENT & MARKET', color:'var(--green)',
    modules:[
      { num:'04', label:'Procurement & Vendors',   phase:'P2', Icon:ShoppingCart },
      { num:'05', label:'Marketplace & Load Board',phase:'P3', Icon:BarChart2 },
      { num:'06', label:'Freight Exchange',        phase:'P3', Icon:Truck },
      { num:'17', label:'Tender & Bid Mgmt',       phase:'P3', Icon:Gavel },
    ]},
  { id:'intelligence', label:'AI & INTELLIGENCE', color:'var(--purple)',
    modules:[
      { num:'08', label:'AI Decision Engine',      phase:'P4', Icon:Cpu },
      { num:'09', label:'Incident Command',        phase:'P1', Icon:AlertOctagon },
      { num:'14', label:'Insurance Intelligence',  phase:'P4', Icon:Shield },
      { num:'18', label:'Risk Intelligence',       phase:'P2', Icon:Activity },
      { num:'35', label:'Predictive Network',      phase:'P6', Icon:Radar },
    ]},
  { id:'financial', label:'FINANCE & COMPLIANCE', color:'var(--orange)',
    modules:[
      { num:'15', label:'SLA & Contract Intel',    phase:'P3', Icon:FileText },
      { num:'16', label:'Revenue Optimisation',    phase:'P3', Icon:TrendingUp },
      { num:'20', label:'Billing & SaaS Admin',    phase:'P3', Icon:DollarSign },
      { num:'31', label:'Regulatory Compliance',   phase:'P5', Icon:Scale },
      { num:'32', label:'Financial Risk & FX',     phase:'P5', Icon:CreditCard },
    ]},
  { id:'platform', label:'PLATFORM & ANALYTICS', color:'var(--cyan)',
    modules:[
      { num:'21', label:'Advanced Analytics',      phase:'P3', Icon:PieChart },
      { num:'22', label:'Workflow Automation',     phase:'P3', Icon:Workflow },
      { num:'23', label:'Communications Layer',    phase:'P3', Icon:MessageSquare },
      { num:'24', label:'Audit & Forensics',       phase:'P3', Icon:Lock },
      { num:'25', label:'Global Map Intelligence', phase:'P3', Icon:Map },
      { num:'26', label:'API Economy',             phase:'P5', Icon:Code },
      { num:'27', label:'White-Label Engine',      phase:'P5', Icon:Layers },
    ]},
  { id:'people', label:'PEOPLE, ESG & SECURITY', color:'var(--green)',
    modules:[
      { num:'19', label:'Carbon & Sustainability', phase:'P4', Icon:Leaf },
      { num:'30', label:'Executive Strategy',      phase:'P5', Icon:Briefcase },
      { num:'33', label:'Driver Welfare & HR',     phase:'P4', Icon:Heart },
      { num:'34', label:'Cybersecurity Ops',       phase:'P4', Icon:ShieldCheck },
    ]},
];

const HIERARCHY = [
  { n:1, t:'HUMAN LIFE & SAFETY',   c:'#f43f5e' },
  { n:2, t:'LEGAL & REGULATORY',    c:'var(--orange)' },
  { n:3, t:'CARGO & ASSET',         c:'var(--amber)' },
  { n:4, t:'CONTRACTUAL (SLA)',      c:'var(--amber-bright)' },
  { n:5, t:'ENVIRONMENTAL',         c:'var(--green)' },
  { n:6, t:'OPERATIONAL',           c:'var(--cyan)' },
  { n:7, t:'COST OPTIMISATION',     c:'var(--purple)' },
  { n:8, t:'REVENUE',               c:'#a78bfa' },
];

export default function Sidebar({ activeModule, setActiveModule, mobileActive }) {
  const [expanded, setExpanded] = useState({ visibility:true, intelligence:true });
  const [search, setSearch] = useState('');

  const toggle = id => setExpanded(e => ({ ...e, [id]: !e[id] }));
  const allMods = CATEGORIES.flatMap(c => c.modules);
  const filtered = search.trim()
    ? allMods.filter(m => m.label.toLowerCase().includes(search.toLowerCase()) || m.num.includes(search))
    : null;

  return (
    <aside className={`sidebar ${mobileActive ? 'mob-show' : ''}`}>
      <div className="sb-search">
        <div className="sb-search-wrap">
          <Search size={13} className="sb-search-icon" />
          <input placeholder="Search 35 modules..."
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      </div>

      <div className="sb-list">
        {filtered ? (
          <>
            <div className="cat-header" style={{ cursor:'default', color:'var(--text-mid)' }}>
              RESULTS ({filtered.length})
            </div>
            {filtered.map(m => {
              const { Icon } = m;
              return (
                <div key={m.num} className={`mod-item ${activeModule===m.num?'active':''}`}
                  onClick={() => setActiveModule(m.num)}>
                  <span className="mod-num">{m.num}</span>
                  <Icon size={13} />
                  <span style={{ flex:1 }}>{m.label}</span>
                  <span className="mod-badge">{m.phase}</span>
                </div>
              );
            })}
          </>
        ) : (
          CATEGORIES.map(cat => (
            <div key={cat.id}>
              <div className="cat-header" onClick={() => toggle(cat.id)}>
                <span style={{ color:cat.color, fontSize:10 }}>▪</span>
                {cat.label}
                <ChevronDown size={11} className={`cat-chevron ${expanded[cat.id]?'open':''}`} />
              </div>
              {expanded[cat.id] && cat.modules.map(m => {
                const { Icon } = m;
                return (
                  <div key={m.num} className={`mod-item ${activeModule===m.num?'active':''}`}
                    onClick={() => setActiveModule(m.num)} title={m.label}>
                    <span className="mod-num">{m.num}</span>
                    <Icon size={13} />
                    <span style={{ flex:1, fontSize:12 }}>{m.label}</span>
                    <span className="mod-badge">{m.phase}</span>
                  </div>
                );
              })}
            </div>
          ))
        )}
      </div>

      <div className="sb-hierarchy">
        <div className="hier-title">⚡ PRIORITY HIERARCHY</div>
        {HIERARCHY.map(h => (
          <div key={h.n} className="hier-row">
            <div className="hier-num" style={{ background:`${h.c}18`, color:h.c }}>{h.n}</div>
            <span style={{ color:h.c, opacity:.85, fontSize:9, fontFamily:'var(--f-mono)', letterSpacing:'0.04em' }}>{h.t}</span>
          </div>
        ))}
      </div>
    </aside>
  );
}
