import { MessageSquare, Grid, BarChart2, Settings } from 'lucide-react';

const TABS = [
  { id:'chat',     label:'CHAT',    Icon:MessageSquare },
  { id:'modules',  label:'MODULES', Icon:Grid },
  { id:'metrics',  label:'METRICS', Icon:BarChart2 },
  { id:'settings', label:'CONFIG',  Icon:Settings },
];

export default function BottomNav({ active, setActive }) {
  return (
    <nav className="bottom-nav">
      {TABS.map(({ id, label, Icon }) => (
        <button key={id} className={`bn-btn ${active === id ? 'active' : ''}`}
          onClick={() => setActive(id)}>
          <Icon size={20} />
          <span className="bn-label">{label}</span>
        </button>
      ))}
    </nav>
  );
}
