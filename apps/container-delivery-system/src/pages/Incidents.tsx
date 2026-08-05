import React, { useState } from 'react';
import { Card } from '@/components/ui/Card.js';
import { Badge } from '@/components/ui/Badge.js';
import { Button } from '@/components/ui/Button.js';

type IncidentFilter = 'all' | 'open' | 'investigating' | 'resolved';

const incidents = [
  { id: 'INC-001', type: 'tamper', severity: 'critical', title: 'Tamper alert on TGHU3456789', description: 'Lock sensor triggered on container TGHU3456789 near Mariakani checkpoint.', shipment: 'SHP-2024-1001', status: 'open', assignedTo: 'James Kinuthia', createdAt: '2024-01-15 14:22', location: 'Mariakani, Kilifi' },
  { id: 'INC-002', type: 'route_deviation', severity: 'high', title: 'Route deviation — KDG 330F', description: 'Vehicle KDG 330F deviated 12km from approved corridor near Sultan Hamud.', shipment: 'SHP-2024-0998', status: 'investigating', assignedTo: 'David Kibet', createdAt: '2024-01-15 11:05', location: 'Sultan Hamud, Makueni' },
  { id: 'INC-003', type: 'breakdown', severity: 'medium', title: 'Engine fault — KCE 771D', description: 'Driver Samuel Kiptoo reported engine warning light. Vehicle stopped at Mtito Andei.', shipment: 'SHP-2024-1003', status: 'investigating', assignedTo: 'Peter Otieno', createdAt: '2024-01-14 18:30', location: 'Mtito Andei' },
  { id: 'INC-004', type: 'unauthorized_stop', severity: 'medium', title: 'Unauthorized stop — 45 min', description: 'Vehicle KDF 887M stopped for 45 minutes at unregistered location near Emali.', shipment: 'SHP-2024-0995', status: 'resolved', assignedTo: 'Mary Wambui', createdAt: '2024-01-14 08:15', location: 'Emali, Makueni' },
  { id: 'INC-005', type: 'lock_failure', severity: 'high', title: 'Lock communication lost — SSL-3340', description: 'E-Lock SSL-3340 went offline. Last heartbeat 4 hours ago.', shipment: null, status: 'open', assignedTo: null, createdAt: '2024-01-13 22:10', location: 'Last known: Voi' },
];

const severityColors: Record<string, { bg: string; text: string }> = {
  critical: { bg: 'bg-cds-red-dim', text: 'text-cds-red' },
  high: { bg: 'bg-cds-red-dim', text: 'text-cds-red' },
  medium: { bg: 'bg-cds-amber-dim', text: 'text-cds-amber' },
  low: { bg: 'bg-cds-teal-dim', text: 'text-cds-teal' },
};

const statusVariants: Record<string, 'bad' | 'warn' | 'ok' | 'neutral'> = {
  open: 'bad',
  investigating: 'warn',
  resolved: 'ok',
  closed: 'neutral',
};

export default function Incidents() {
  const [filter, setFilter] = useState<IncidentFilter>('all');
  const filtered = filter === 'all' ? incidents : incidents.filter((i) => i.status === filter);

  return (
    <div className="p-6 pb-10 animate-fade-in">
      <div className="flex items-center justify-between mb-1">
        <div>
          <h2 className="font-display font-bold text-[17px] m-0">Incidents</h2>
          <p className="text-[12px] text-text-2 m-0 mt-1">{incidents.filter((i) => i.status === 'open').length} open · {incidents.filter((i) => i.status === 'investigating').length} under investigation</p>
        </div>
        <Button icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>}>
          Report Incident
        </Button>
      </div>

      <div className="grid grid-cols-4 gap-3 mt-4">
        {[
          { label: 'Open', value: incidents.filter((i) => i.status === 'open').length, color: 'text-cds-red' },
          { label: 'Investigating', value: incidents.filter((i) => i.status === 'investigating').length, color: 'text-cds-amber' },
          { label: 'Resolved (7d)', value: incidents.filter((i) => i.status === 'resolved').length, color: 'text-cds-teal' },
          { label: 'Avg Resolution', value: '4.2h', color: 'text-text-0' },
        ].map((kpi) => (
          <Card key={kpi.label} className="p-3.5">
            <div className="text-[10px] font-mono text-text-2 uppercase tracking-wider">{kpi.label}</div>
            <div className={`text-[22px] font-display font-bold mt-1 ${kpi.color}`}>{kpi.value}</div>
          </Card>
        ))}
      </div>

      <div className="flex gap-2 mt-5 mb-3">
        {(['all', 'open', 'investigating', 'resolved'] as IncidentFilter[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3.5 py-1.5 rounded-full text-[12px] font-medium capitalize transition-colors ${filter === f ? 'bg-cds-orange text-white' : 'bg-ink-3 text-text-1 hover:text-text-0'}`}
          >
            {f} {f !== 'all' ? `(${incidents.filter((i) => f === 'all' || i.status === f).length})` : `(${incidents.length})`}
          </button>
        ))}
      </div>

      <Card className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[12.5px]">
            <thead>
              <tr>
                {['ID', 'Severity', 'Title', 'Type', 'Location', 'Assigned To', 'Created', 'Status'].map((h) => (
                  <th key={h} className="text-left font-mono text-[10px] tracking-[0.06em] text-text-2 uppercase px-3.5 pb-2.5 pt-3 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((inc) => {
                const sev = severityColors[inc.severity] ?? severityColors.medium;
                return (
                  <tr key={inc.id} className="border-t border-hair cursor-pointer hover:bg-ink-2 transition-colors">
                    <td className="px-3.5 py-3 font-mono font-semibold text-text-0">{inc.id}</td>
                    <td className="px-3.5 py-3">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-semibold uppercase ${sev.bg} ${sev.text}`}>{inc.severity}</span>
                    </td>
                    <td className="px-3.5 py-3 text-text-0 max-w-[260px]">
                      <div className="truncate">{inc.title}</div>
                      {inc.shipment && <div className="text-[10.5px] text-text-2 mt-0.5 font-mono">{inc.shipment}</div>}
                    </td>
                    <td className="px-3.5 py-3 font-mono text-text-1 capitalize">{inc.type.replace('_', ' ')}</td>
                    <td className="px-3.5 py-3 text-text-1">{inc.location}</td>
                    <td className="px-3.5 py-3 text-text-0">{inc.assignedTo ?? <span className="text-text-2">Unassigned</span>}</td>
                    <td className="px-3.5 py-3 font-mono text-text-2 text-[11px]">{inc.createdAt}</td>
                    <td className="px-3.5 py-3"><Badge variant={statusVariants[inc.status] ?? 'neutral'}>{inc.status.toUpperCase()}</Badge></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
