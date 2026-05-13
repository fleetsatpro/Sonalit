import { useState } from 'react';
import {
  Eye, Package, Globe, ShoppingCart, BarChart2, Truck, Cpu, AlertOctagon,
  Smartphone, Users, Wifi, Camera, Shield, FileText, TrendingUp, Gavel,
  Activity, Leaf, DollarSign, PieChart, Workflow, MessageSquare, Lock,
  Map, Code, Layers, Navigation, Bot, Briefcase, Scale, CreditCard,
  Heart, ShieldCheck, Radar, ChevronDown, Search
} from 'lucide-react';

const MODULE_CATEGORIES = [
  {
    id: 'visibility',
    label: 'VISIBILITY & SUPPLY CHAIN',
    color: 'var(--cyan)',
    modules: [
      { num: '01', label: 'Supply Chain Visibility', sub: 'QUANTUM MESH', phase: 'P1', icon: Eye },
      { num: '02', label: 'Warehouse Management', sub: 'LIVE INVENTORY', phase: 'P2', icon: Package },
      { num: '03', label: 'Customs & Border Intel', sub: 'TRADE ACCELERATOR', phase: 'P2', icon: Globe },
      { num: '07', label: 'Digital Twin Engine', sub: 'MIRROR WORLD', phase: 'P2', icon: Layers },
    ]
  },
  {
    id: 'fleet',
    label: 'FLEET & FIELD ASSETS',
    color: 'var(--amber)',
    modules: [
      { num: '10', label: 'Driver Mobile App', sub: 'CONNECTED CMDR', phase: 'P1', icon: Smartphone },
      { num: '11', label: 'Contractor Portal', sub: 'ENTERPRISE GOV', phase: 'P3', icon: Users },
      { num: '12', label: 'IoT Sensor Command', sub: 'PHYSICAL INTERNET', phase: 'P1', icon: Wifi },
      { num: '13', label: 'Computer Vision', sub: 'EVER-WATCHFUL EYE', phase: 'P4', icon: Camera },
      { num: '28', label: 'Multi-Modal Logistics', sub: 'MOVEMENT FABRIC', phase: 'P5', icon: Navigation },
      { num: '29', label: 'Autonomous Readiness', sub: 'EDGE-TO-CLOUD', phase: 'P5', icon: Bot },
    ]
  },
  {
    id: 'procurement',
    label: 'PROCUREMENT & MARKET',
    color: 'var(--green)',
    modules: [
      { num: '04', label: 'Procurement & Vendors', sub: 'SUPPLIER GRAPH', phase: 'P2', icon: ShoppingCart },
      { num: '05', label: 'Marketplace & Load Board', sub: 'FREIGHT EXCHANGE', phase: 'P3', icon: BarChart2 },
      { num: '06', label: 'Freight Exchange', sub: 'EMPTY-MILE ELIM', phase: 'P3', icon: Truck },
      { num: '17', label: 'Tender & Bid Mgmt', sub: 'SMART PROCURE', phase: 'P3', icon: Gavel },
    ]
  },
  {
    id: 'intelligence',
    label: 'AI & INTELLIGENCE',
    color: 'var(--purple)',
    modules: [
      { num: '08', label: 'AI Decision Engine', sub: 'LOGISTICS CORTEX', phase: 'P4', icon: Cpu },
      { num: '09', label: 'Incident Command', sub: 'CRISIS ORCHSTR', phase: 'P1', icon: AlertOctagon },
      { num: '14', label: 'Insurance Intelligence', sub: 'RISK-BASED PREMI', phase: 'P4', icon: Shield },
      { num: '18', label: 'Risk Intelligence', sub: 'THREAT MESH', phase: 'P2', icon: Activity },
      { num: '35', label: 'Predictive Network', sub: 'ANTICIPATORY', phase: 'P6', icon: Radar },
    ]
  },
  {
    id: 'financial',
    label: 'FINANCE & COMPLIANCE',
    color: 'var(--orange)',
    modules: [
      { num: '15', label: 'SLA & Contract Intel', sub: 'AUTO GOVERNANCE', phase: 'P3', icon: FileText },
      { num: '16', label: 'Revenue Optimisation', sub: 'PROFIT ENGINE', phase: 'P3', icon: TrendingUp },
      { num: '20', label: 'Billing & SaaS Admin', sub: 'MONETISATION', phase: 'P3', icon: DollarSign },
      { num: '31', label: 'Regulatory Compliance', sub: 'LEGAL RADAR', phase: 'P5', icon: Scale },
      { num: '32', label: 'Financial Risk & FX', sub: 'ECON RESILIENCE', phase: 'P5', icon: CreditCard },
    ]
  },
  {
    id: 'platform',
    label: 'PLATFORM & ANALYTICS',
    color: 'var(--cyan)',
    modules: [
      { num: '21', label: 'Advanced Analytics', sub: 'SELF-SERVICE BI', phase: 'P3', icon: PieChart },
      { num: '22', label: 'Workflow Automation', sub: 'HYPERAUTOMATION', phase: 'P3', icon: Workflow },
      { num: '23', label: 'Communication Layer', sub: 'MISSION COLLAB', phase: 'P3', icon: MessageSquare },
      { num: '24', label: 'Audit & Forensics', sub: 'IMMUTABLE TRUTH', phase: 'P3', icon: Lock },
      { num: '25', label: 'Global Map Intel', sub: 'LOGISTICS GLOBE', phase: 'P3', icon: Map },
      { num: '26', label: 'API Economy', sub: 'PLATFORM-AS-SVC', phase: 'P5', icon: Code },
      { num: '27', label: 'White-Label Engine', sub: 'INFINITE BRAND', phase: 'P5', icon: Layers },
    ]
  },
  {
    id: 'people',
    label: 'PEOPLE & SECURITY',
    color: 'var(--green)',
    modules: [
      { num: '19', label: 'Carbon & Sustainability', sub: 'GREEN LOGISTICS', phase: 'P4', icon: Leaf },
      { num: '33', label: 'Driver Welfare & HR', sub: 'PEOPLE LAYER', phase: 'P4', icon: Heart },
      { num: '34', label: 'Cybersecurity Ops', sub: 'DIGITAL FORTRESS', phase: 'P4', icon: ShieldCheck },
      { num: '30', label: 'Executive Strategy', sub: 'C-SUITE COPILOT', phase: 'P5', icon: Briefcase },
    ]
  },
];

const PRIORITY_HIERARCHY = [
  { level: 1, label: 'HUMAN LIFE & SAFETY',    color: '#f43f5e', bg: 'rgba(244,63,94,0.12)' },
  { level: 2, label: 'LEGAL & REGULATORY',      color: '#fb923c', bg: 'rgba(251,146,60,0.1)' },
  { level: 3, label: 'CARGO & ASSET SECURITY',  color: '#f59e0b', bg: 'rgba(245,158,11,0.1)' },
  { level: 4, label: 'CONTRACTUAL (SLA)',        color: '#fbbf24', bg: 'rgba(251,191,36,0.08)' },
  { level: 5, label: 'ENVIRONMENTAL',           color: '#34d399', bg: 'rgba(52,211,153,0.08)' },
  { level: 6, label: 'OPERATIONAL EFFICIENCY',  color: '#22d3ee', bg: 'rgba(34,211,238,0.08)' },
  { level: 7, label: 'COST OPTIMISATION',       color: '#818cf8', bg: 'rgba(129,140,248,0.08)' },
  { level: 8, label: 'REVENUE MAXIMISATION',    color: '#a78bfa', bg: 'rgba(167,139,250,0.08)' },
];

export default function Sidebar({ activeModule, setActiveModule }) {
  const [expanded, setExpanded] = useState({ visibility: true, fleet: false, procurement: false, intelligence: true, financial: false, platform: false, people: false });
  const [search, setSearch] = useState('');

  const toggle = (id) => setExpanded(e => ({ ...e, [id]: !e[id] }));

  const allModules = MODULE_CATEGORIES.flatMap(c => c.modules.map(m => ({ ...m, catId: c.id })));
  const filtered = search.trim()
    ? allModules.filter(m =>
        m.label.toLowerCase().includes(search.toLowerCase()) ||
        m.num.includes(search) ||
        m.sub.toLowerCase().includes(search.toLowerCase())
      )
    : null;

  return (
    <aside className="sidebar">
      {/* Search */}
      <div className="sidebar-search">
        <div className="sidebar-search-wrap">
          <Search size={12} className="sidebar-search-icon" />
          <input
            placeholder="Search 35 modules..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Module List */}
      <div className="sidebar-modules">
        {filtered ? (
          <div>
            <div className="module-category-header" style={{ cursor: 'default' }}>
              <span>SEARCH RESULTS ({filtered.length})</span>
            </div>
            {filtered.map(m => {
              const Icon = m.icon;
              return (
                <div
                  key={m.num}
                  className={`module-item ${activeModule === m.num ? 'active' : ''}`}
                  onClick={() => setActiveModule(m.num)}
                >
                  <span className="module-number">{m.num}</span>
                  <Icon size={12} />
                  <span style={{ flex: 1, fontSize: '11px' }}>{m.label}</span>
                  <span className="module-phase-badge">{m.phase}</span>
                </div>
              );
            })}
          </div>
        ) : (
          MODULE_CATEGORIES.map(cat => (
            <div key={cat.id} className="module-category">
              <div className="module-category-header" onClick={() => toggle(cat.id)}>
                <span style={{ color: cat.color, marginRight: 2 }}>▪</span>
                {cat.label}
                <ChevronDown
                  size={10}
                  className={`module-category-toggle ${expanded[cat.id] ? 'open' : ''}`}
                  style={{ marginLeft: 'auto' }}
                />
              </div>

              {expanded[cat.id] && (
                <div className="module-list">
                  {cat.modules.map(m => {
                    const Icon = m.icon;
                    return (
                      <div
                        key={m.num}
                        className={`module-item ${activeModule === m.num ? 'active' : ''}`}
                        onClick={() => setActiveModule(m.num)}
                        title={m.sub}
                      >
                        <span className="module-number">{m.num}</span>
                        <Icon size={12} />
                        <span style={{ flex: 1, fontSize: '11px' }}>{m.label}</span>
                        <span className="module-phase-badge">{m.phase}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Priority Hierarchy */}
      <div className="sidebar-hierarchy">
        <div className="hierarchy-title">⚡ PRIORITY HIERARCHY</div>
        {PRIORITY_HIERARCHY.map(h => (
          <div key={h.level} className="hierarchy-item">
            <div className="hierarchy-level" style={{ background: h.bg, color: h.color }}>
              {h.level}
            </div>
            <span style={{ color: h.color, opacity: 0.85, fontSize: '8px', letterSpacing: '0.05em' }}>
              {h.label}
            </span>
          </div>
        ))}
      </div>
    </aside>
  );
}
