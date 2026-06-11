const CONTINENTS = [
    { key: 'global', label: 'Global' },
    { key: 'africa', label: 'Africa' },
    { key: 'asia', label: 'Asia' },
    { key: 'europe', label: 'Europe' },
    { key: 'americas', label: 'Americas' },
    { key: 'mideast', label: 'Mid East' },
    { key: 'oceania', label: 'Oceania' },
];
export default function ContinentBar({ active, zones, onChange }) {
    const countFor = (key) => key === 'global' ? zones.length : zones.filter(z => z.continent === key).length;
    return (<div style={{
            display: 'flex',
            gap: 0,
            background: '#0d1520',
            borderBottom: '1px solid rgba(255,255,255,.07)',
            overflowX: 'auto',
            padding: '0 8px',
        }}>
      {CONTINENTS.map(({ key, label }) => {
            const isActive = active === key;
            const count = countFor(key);
            return (<button key={key} onClick={() => onChange(key)} style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '8px 14px',
                    background: 'none',
                    border: 'none',
                    borderBottom: isActive ? '2px solid #F0B429' : '2px solid transparent',
                    cursor: 'pointer',
                    color: isActive ? '#F0B429' : '#9a9890',
                    fontFamily: 'IBM Plex Mono, monospace',
                    fontSize: 11,
                    letterSpacing: '.05em',
                    textTransform: 'uppercase',
                    whiteSpace: 'nowrap',
                    transition: 'color .15s',
                }}>
            {label}
            {count > 0 && (<span style={{
                        background: isActive ? 'rgba(240,180,41,.2)' : 'rgba(255,255,255,.08)',
                        color: isActive ? '#F0B429' : '#6e6c64',
                        borderRadius: 10,
                        padding: '1px 6px',
                        fontSize: 9,
                        fontWeight: 700,
                    }}>{count}</span>)}
          </button>);
        })}
    </div>);
}
