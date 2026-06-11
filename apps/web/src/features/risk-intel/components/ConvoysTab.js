import { levelColor, levelBg, levelBorder } from '../utils/colors.js';
import { useRiskConvoys } from '../hooks/useRiskConvoys.js';
export default function ConvoysTab({ zone }) {
    const { data, isLoading } = useRiskConvoys(zone.continent);
    const convoys = (data?.convoys ?? []).filter(c => c.affected_zones.some(z => z === zone.id || z === zone.zone_code));
    if (isLoading) {
        return <div style={{ padding: 16, fontSize: 11, color: '#6e6c64' }}>Loading convoys…</div>;
    }
    if (!convoys.length) {
        return (<div style={{ padding: 24, textAlign: 'center' }}>
        <div style={{ fontSize: 13, color: '#6e6c64', marginBottom: 4 }}>No Active Convoys</div>
        <div style={{ fontSize: 11, color: '#4e4c44' }}>No convoys are currently operating in this risk zone</div>
      </div>);
    }
    return (<div style={{ padding: 16 }}>
      <div style={{ fontSize: 10, color: '#6e6c64', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '.08em' }}>
        {convoys.length} convoy{convoys.length !== 1 ? 's' : ''} exposed
      </div>
      {convoys.map(c => {
            const color = levelColor(c.highest_level);
            const bg = levelBg(c.highest_level);
            const border = levelBorder(c.highest_level);
            return (<div key={c.id} style={{
                    padding: '10px 12px',
                    background: bg,
                    border: `1px solid ${border}`,
                    borderRadius: 8,
                    marginBottom: 8,
                }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#e8e6df' }}>{c.name}</div>
              <span style={{
                    fontSize: 9,
                    fontWeight: 700,
                    color,
                    background: `rgba(0,0,0,.3)`,
                    border: `1px solid ${border}`,
                    borderRadius: 4,
                    padding: '1px 6px',
                    textTransform: 'uppercase',
                }}>{c.highest_level}</span>
            </div>
            {c.driver_name && (<div style={{ fontSize: 10, color: '#9a9890', marginTop: 3 }}>Driver: {c.driver_name}</div>)}
            <div style={{ fontSize: 10, color: '#6e6c64', marginTop: 2 }}>Status: {c.status}</div>
          </div>);
        })}
    </div>);
}
