import React, { useState } from 'react';
import { Card } from '@/components/ui/Card.js';
import { Badge } from '@/components/ui/Badge.js';
import { Button } from '@/components/ui/Button.js';

const geofences = [
  { id: 'gf-1', name: 'Mombasa Port', type: 'polygon', category: 'port', radius: null, alerts: ['entry', 'exit'], active: true, vehiclesInside: 3, lastTriggered: '10m ago' },
  { id: 'gf-2', name: 'Nairobi ICD', type: 'polygon', category: 'warehouse', radius: null, alerts: ['entry', 'exit', 'idle_timeout'], active: true, vehiclesInside: 1, lastTriggered: '1h ago' },
  { id: 'gf-3', name: 'Mariakani Checkpoint', type: 'circle', category: 'border', radius: '2.5 km', alerts: ['entry', 'overspeed'], active: true, vehiclesInside: 0, lastTriggered: '3h ago' },
  { id: 'gf-4', name: 'Voi Rest Stop', type: 'circle', category: 'corridor', radius: '1.0 km', alerts: ['unauthorized_stop', 'idle_timeout'], active: true, vehiclesInside: 1, lastTriggered: '25m ago' },
  { id: 'gf-5', name: 'Mtito Andei Checkpoint', type: 'circle', category: 'border', radius: '3.0 km', alerts: ['entry', 'exit'], active: true, vehiclesInside: 0, lastTriggered: '5h ago' },
  { id: 'gf-6', name: 'Naivasha Warehouse', type: 'polygon', category: 'warehouse', radius: null, alerts: ['entry', 'exit', 'idle_timeout'], active: false, vehiclesInside: 0, lastTriggered: '2d ago' },
  { id: 'gf-7', name: 'Nakuru – Mombasa Corridor', type: 'corridor', category: 'corridor', radius: '500m buffer', alerts: ['route_deviation', 'overspeed', 'unauthorized_stop'], active: true, vehiclesInside: 4, lastTriggered: '5m ago' },
];

const categoryColors: Record<string, string> = {
  port: 'text-cds-orange',
  warehouse: 'text-cds-teal',
  border: 'text-cds-amber',
  corridor: 'text-text-1',
  customer: 'text-cds-teal',
  restricted: 'text-cds-red',
};

const alertLabels: Record<string, string> = {
  entry: 'Entry',
  exit: 'Exit',
  overspeed: 'Overspeed',
  unauthorized_stop: 'Unauth Stop',
  route_deviation: 'Route Dev',
  idle_timeout: 'Idle',
};

export default function Geofences() {
  const [filter, setFilter] = useState<string>('all');
  const filtered = filter === 'all' ? geofences : geofences.filter((g) => g.category === filter);

  return (
    <div className="p-6 pb-10 animate-fade-in">
      <div className="flex items-center justify-between mb-1">
        <div>
          <h2 className="font-display font-bold text-[17px] m-0">Geofences</h2>
          <p className="text-[12px] text-text-2 m-0 mt-1">{geofences.length} zones configured · {geofences.filter((g) => g.active).length} active · {geofences.reduce((a, g) => a + g.vehiclesInside, 0)} vehicles inside zones</p>
        </div>
        <Button icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>}>
          Create Geofence
        </Button>
      </div>

      <div className="grid grid-cols-[1.6fr_1fr] gap-4 mt-4 items-start">
        <Card className="h-[420px] p-0 relative overflow-hidden">
          <div className="w-full h-full relative" style={{
            background: 'linear-gradient(rgba(255,255,255,0.07) 1px, transparent 1px) 0 0/40px 40px, linear-gradient(90deg, rgba(255,255,255,0.07) 1px, transparent 1px) 0 0/40px 40px, radial-gradient(400px 200px at 50% 50%, rgba(51,214,168,0.06), transparent), #14171b',
          }}>
            <div className="absolute top-3.5 left-4 z-10">
              <div className="font-display font-bold text-[13px]">Geofence Map View</div>
              <div className="text-[10.5px] text-text-2 font-mono">{filtered.length} zones visible · Real-time vehicle overlay</div>
            </div>
            {filtered.filter((g) => g.active).map((g, i) => (
              <div
                key={g.id}
                className="absolute rounded-full border-2 border-dashed opacity-60"
                style={{
                  width: g.type === 'corridor' ? '80%' : `${60 + i * 15}px`,
                  height: g.type === 'corridor' ? '30px' : `${60 + i * 15}px`,
                  left: `${10 + i * 12}%`,
                  top: `${25 + (i % 3) * 20}%`,
                  borderColor: g.category === 'port' ? '#ff7a00' : g.category === 'warehouse' ? '#33d6a8' : '#ffb020',
                  background: `${g.category === 'port' ? 'rgba(255,122,0,0.08)' : g.category === 'warehouse' ? 'rgba(51,214,168,0.08)' : 'rgba(255,176,32,0.08)'}`,
                  borderRadius: g.type === 'corridor' ? '20px' : '50%',
                }}
              />
            ))}
            <div className="absolute bottom-3.5 left-4 flex gap-3.5 z-10 text-[10.5px] text-text-1 font-mono">
              <span className="flex items-center gap-[5px]"><span className="w-[7px] h-[7px] rounded-full bg-cds-orange" />Port</span>
              <span className="flex items-center gap-[5px]"><span className="w-[7px] h-[7px] rounded-full bg-cds-teal" />Warehouse</span>
              <span className="flex items-center gap-[5px]"><span className="w-[7px] h-[7px] rounded-full bg-cds-amber" />Checkpoint</span>
            </div>
          </div>
        </Card>

        <div className="space-y-3">
          <div className="flex gap-1.5 flex-wrap">
            {['all', 'port', 'warehouse', 'border', 'corridor'].map((cat) => (
              <button
                key={cat}
                onClick={() => setFilter(cat)}
                className={`px-3 py-1 rounded-full text-[11px] font-medium transition-colors capitalize ${filter === cat ? 'bg-cds-orange text-white' : 'bg-ink-3 text-text-1 hover:text-text-0'}`}
              >
                {cat}
              </button>
            ))}
          </div>

          <div className="space-y-2 max-h-[360px] overflow-y-auto">
            {filtered.map((g) => (
              <Card key={g.id} className="p-3 cursor-pointer hover:bg-ink-3 transition-colors">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-[12.5px] font-semibold text-text-0">{g.name}</div>
                    <div className="text-[10.5px] text-text-2 font-mono mt-0.5">
                      <span className={categoryColors[g.category]}>{g.category.toUpperCase()}</span> · {g.type}{g.radius ? ` · ${g.radius}` : ''}
                    </div>
                  </div>
                  {g.active ? <Badge variant="ok">ACTIVE</Badge> : <Badge variant="neutral">OFF</Badge>}
                </div>
                <div className="flex gap-1 mt-2 flex-wrap">
                  {g.alerts.map((a) => (
                    <span key={a} className="px-1.5 py-0.5 rounded bg-ink-3 text-[9.5px] font-mono text-text-1">{alertLabels[a] ?? a}</span>
                  ))}
                </div>
                <div className="flex items-center justify-between mt-2 text-[10.5px] text-text-2 font-mono">
                  <span>{g.vehiclesInside} vehicles inside</span>
                  <span>Last: {g.lastTriggered}</span>
                </div>
              </Card>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
