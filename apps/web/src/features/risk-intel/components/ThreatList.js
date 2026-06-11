import ThreatCard from './ThreatCard.js';
const LEVELS = [
    { key: 'all', label: 'All' },
    { key: 'high', label: 'High' },
    { key: 'medium', label: 'Med' },
    { key: 'low', label: 'Low' },
];
const LEVEL_DOT = {
    high: '#E24B4A',
    medium: '#EF9F27',
    low: '#4ade80',
};
export default function ThreatList({ zones, levelFilter, activeId, onSelect, onLevelChange }) {
    const filtered = levelFilter === 'all' ? zones : zones.filter(z => z.level === levelFilter);
    return (<div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Filter bar */}
      <div style={{
            display: 'flex',
            gap: 4,
            padding: '8px 12px',
            borderBottom: '1px solid rgba(255,255,255,.06)',
            flexShrink: 0,
        }}>
        {LEVELS.map(({ key, label }) => (<button key={key} onClick={() => onLevelChange(key)} style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                padding: '3px 10px',
                background: levelFilter === key ? 'rgba(240,180,41,.12)' : 'rgba(255,255,255,.04)',
                border: `1px solid ${levelFilter === key ? 'rgba(240,180,41,.3)' : 'rgba(255,255,255,.06)'}`,
                borderRadius: 20,
                cursor: 'pointer',
                fontSize: 10,
                fontWeight: 600,
                color: levelFilter === key ? '#F0B429' : '#6e6c64',
                transition: 'all .15s',
            }}>
            {key !== 'all' && (<span style={{ width: 6, height: 6, borderRadius: '50%', background: LEVEL_DOT[key] }}/>)}
            {label}
          </button>))}
        <span style={{ marginLeft: 'auto', fontSize: 10, color: '#4e4c44', alignSelf: 'center' }}>
          {filtered.length} zone{filtered.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Scrollable list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 10px' }}>
        {filtered.length === 0 && (<div style={{ padding: 24, textAlign: 'center', fontSize: 12, color: '#4e4c44' }}>
            No {levelFilter !== 'all' ? levelFilter : ''} risk zones
          </div>)}
        {filtered.map(zone => (<ThreatCard key={zone.id} zone={zone} active={activeId === zone.id} onClick={() => onSelect(zone.id)}/>))}
      </div>
    </div>);
}
