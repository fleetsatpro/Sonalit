import { levelColor } from '../utils/colors.js';
import Sparkline from './Sparkline.js';
function Row({ label, value }) {
    return (<div style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid rgba(255,255,255,.05)' }}>
      <span style={{ fontSize: 11, color: '#6e6c64' }}>{label}</span>
      <span style={{ fontSize: 11, color: '#e8e6df', fontFamily: 'IBM Plex Mono, monospace' }}>{value}</span>
    </div>);
}
export default function AnalyticsTab({ zone, events }) {
    const color = levelColor(zone.level);
    return (<div style={{ padding: '16px' }}>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 10, color: '#6e6c64', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '.08em' }}>7-Day Event Trend</div>
        <Sparkline data={zone.week_data ?? []} color={color} width={240} height={40}/>
      </div>
      <Row label="Total events" value={zone.events}/>
      <Row label="Last 24h" value={zone.events_24h}/>
      <Row label="Confidence" value={`${zone.confidence ?? '—'}%`}/>
      <Row label="Velocity" value={zone.velocity}/>
      <Row label="When active" value={zone.when_active || '—'}/>
      {zone.why && (<div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 10, color: '#6e6c64', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '.08em' }}>Why this zone?</div>
          <p style={{ fontSize: 11, color: '#c8c6bf', lineHeight: 1.6 }}>{zone.why}</p>
        </div>)}
      {zone.precaution && (<div style={{ marginTop: 12, padding: '10px 12px', background: 'rgba(240,180,41,.07)', borderRadius: 6, border: '1px solid rgba(240,180,41,.2)' }}>
          <div style={{ fontSize: 10, color: '#F0B429', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '.08em' }}>Precaution</div>
          <p style={{ fontSize: 11, color: '#e8e6df', lineHeight: 1.6 }}>{zone.precaution}</p>
        </div>)}
      {events.length > 0 && (<div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 10, color: '#6e6c64', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '.08em' }}>Recent Events</div>
          {events.slice(0, 8).map(ev => (<div key={ev.id} style={{ padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,.05)', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: levelColor(ev.level), marginTop: 3, flexShrink: 0 }}/>
              <div>
                <div style={{ fontSize: 11, color: '#c8c6bf' }}>{ev.description}</div>
                <div style={{ fontSize: 9, color: '#6e6c64', marginTop: 2 }}>
                  {new Date(ev.occurred_at).toLocaleString()} · {ev.source}
                </div>
              </div>
            </div>))}
        </div>)}
    </div>);
}
