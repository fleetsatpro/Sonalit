import React, { useState } from 'react';
import { Card } from '@/components/ui/Card.js';
import { Badge } from '@/components/ui/Badge.js';
import { Button } from '@/components/ui/Button.js';

type SeverityFilter = 'all' | 'critical' | 'high' | 'medium' | 'low';

const alerts = [
  { id: 'ALT-0041', severity: 'critical', type: 'Tamper Detected', entity: 'TGHU3456789', message: 'Lock sensor tamper detected — container door may have been opened.', time: '2m ago', acknowledged: false },
  { id: 'ALT-0040', severity: 'high', type: 'Battery Critical', entity: 'SSL-3340', message: 'E-Lock battery at 5%. Solar panel not charging — overcast conditions.', time: '18m ago', acknowledged: false },
  { id: 'ALT-0039', severity: 'high', type: 'Geofence Breach', entity: 'KDG 330F', message: 'Vehicle exited Nakuru-Mombasa corridor. 12km deviation detected.', time: '45m ago', acknowledged: false },
  { id: 'ALT-0038', severity: 'medium', type: 'Overspeed', entity: 'KCE 771D', message: 'Vehicle exceeded 110 km/h on Nairobi-Mombasa highway (limit: 80 km/h).', time: '1h ago', acknowledged: true },
  { id: 'ALT-0037', severity: 'medium', type: 'Idle Timeout', entity: 'KDF 887M', message: 'Vehicle stationary for 45 minutes at unregistered location.', time: '2h ago', acknowledged: true },
  { id: 'ALT-0036', severity: 'low', type: 'Heartbeat Delay', entity: 'SSL-2218', message: 'E-Lock heartbeat delayed by 8 minutes (threshold: 5 min).', time: '3h ago', acknowledged: true },
  { id: 'ALT-0035', severity: 'medium', type: 'ETA Exceeded', entity: 'SHP-2024-0998', message: 'Shipment SHP-2024-0998 exceeded estimated arrival by 3 hours.', time: '4h ago', acknowledged: true },
  { id: 'ALT-0034', severity: 'low', type: 'Lock Firmware', entity: 'SSL-1190', message: 'Firmware update available: v3.2.1 → v3.3.0.', time: '6h ago', acknowledged: false },
];

const severityStyles: Record<string, { dot: string; badge: 'bad' | 'warn' | 'ok' | 'neutral' }> = {
  critical: { dot: 'bg-cds-red', badge: 'bad' },
  high: { dot: 'bg-cds-red', badge: 'bad' },
  medium: { dot: 'bg-cds-amber', badge: 'warn' },
  low: { dot: 'bg-cds-teal', badge: 'ok' },
  info: { dot: 'bg-text-2', badge: 'neutral' },
};

export default function Alerts() {
  const [filter, setFilter] = useState<SeverityFilter>('all');
  const filtered = filter === 'all' ? alerts : alerts.filter((a) => a.severity === filter);
  const unacked = alerts.filter((a) => !a.acknowledged).length;

  return (
    <div className="p-6 pb-10 animate-fade-in">
      <div className="flex items-center justify-between mb-1">
        <div>
          <h2 className="font-display font-bold text-[17px] m-0">Alerts</h2>
          <p className="text-[12px] text-text-2 m-0 mt-1">{unacked} unacknowledged · {alerts.length} total in last 24h</p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost">Mark All Read</Button>
          <Button icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12.22 2h-.44a2 2 0 00-2 2v.18a2 2 0 01-1 1.73l-.43.25a2 2 0 01-2 0l-.15-.08a2 2 0 00-2.73.73l-.22.38a2 2 0 00.73 2.73l.15.1a2 2 0 011 1.72v.51a2 2 0 01-1 1.74l-.15.09a2 2 0 00-.73 2.73l.22.38a2 2 0 002.73.73l.15-.08a2 2 0 012 0l.43.25a2 2 0 011 1.73V20a2 2 0 002 2h.44a2 2 0 002-2v-.18a2 2 0 011-1.73l.43-.25a2 2 0 012 0l.15.08a2 2 0 002.73-.73l.22-.39a2 2 0 00-.73-2.73l-.15-.08a2 2 0 01-1-1.74v-.5a2 2 0 011-1.74l.15-.09a2 2 0 00.73-2.73l-.22-.38a2 2 0 00-2.73-.73l-.15.08a2 2 0 01-2 0l-.43-.25a2 2 0 01-1-1.73V4a2 2 0 00-2-2z" /><circle cx="12" cy="12" r="3" /></svg>}>
            Alert Rules
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-3 mt-4">
        {[
          { label: 'Critical', value: alerts.filter((a) => a.severity === 'critical').length, color: 'text-cds-red' },
          { label: 'High', value: alerts.filter((a) => a.severity === 'high').length, color: 'text-cds-red' },
          { label: 'Medium', value: alerts.filter((a) => a.severity === 'medium').length, color: 'text-cds-amber' },
          { label: 'Low', value: alerts.filter((a) => a.severity === 'low').length, color: 'text-cds-teal' },
        ].map((kpi) => (
          <Card key={kpi.label} className="p-3.5">
            <div className="text-[10px] font-mono text-text-2 uppercase tracking-wider">{kpi.label}</div>
            <div className={`text-[22px] font-display font-bold mt-1 ${kpi.color}`}>{kpi.value}</div>
          </Card>
        ))}
      </div>

      <div className="flex gap-2 mt-5 mb-3">
        {(['all', 'critical', 'high', 'medium', 'low'] as SeverityFilter[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3.5 py-1.5 rounded-full text-[12px] font-medium capitalize transition-colors ${filter === f ? 'bg-cds-orange text-white' : 'bg-ink-3 text-text-1 hover:text-text-0'}`}
          >
            {f}
          </button>
        ))}
      </div>

      <Card className="p-0">
        <div className="space-y-0">
          {filtered.map((a) => {
            const style = severityStyles[a.severity] ?? severityStyles.info;
            return (
              <div key={a.id} className={`flex items-start gap-3 px-4 py-3.5 border-b border-hair cursor-pointer hover:bg-ink-2 transition-colors ${!a.acknowledged ? 'bg-ink-1' : ''}`}>
                <div className={`w-2 h-2 rounded-full mt-1.5 flex-none ${style.dot} ${!a.acknowledged ? 'animate-pulse-dot' : 'opacity-40'}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[12.5px] font-semibold text-text-0">{a.type}</span>
                    <span className="text-[10.5px] font-mono text-text-2">{a.entity}</span>
                    <Badge variant={style.badge}>{a.severity.toUpperCase()}</Badge>
                  </div>
                  <div className="text-[12px] text-text-1 mt-0.5">{a.message}</div>
                  <div className="text-[10.5px] text-text-2 font-mono mt-1">{a.id} · {a.time}</div>
                </div>
                {!a.acknowledged && (
                  <Button size="sm" variant="ghost">ACK</Button>
                )}
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
