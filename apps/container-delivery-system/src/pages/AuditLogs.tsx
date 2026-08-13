import React, { useState } from 'react';
import { Button } from '@/components/ui/Button.js';
import { PageHeader } from '@/components/ui/PageHeader.js';
import { SearchInput } from '@/components/ui/SearchInput.js';

const auditLogs = [
  { id: 'AUD-10041', action: 'lock.assign', entity: 'SSL-2218', entityType: 'lock', user: 'John Kamau', detail: 'Lock SSL-2218 assigned to container TGHU3456789', ip: '196.201.xx.xx', time: '14:30:22' },
  { id: 'AUD-10040', action: 'shipment.transition', entity: 'SHP-2024-1001', entityType: 'shipment', user: 'System', detail: 'Status changed: lock_assigned → tracking_active', ip: '10.0.1.xx', time: '14:30:20' },
  { id: 'AUD-10039', action: 'lock.clamp', entity: 'SSL-2218', entityType: 'lock', user: 'John Kamau', detail: 'E-Lock clamped on container TGHU3456789 at Nakuru WH', ip: '196.201.xx.xx', time: '14:28:15' },
  { id: 'AUD-10038', action: 'vehicle.assign', entity: 'KDK 456P', entityType: 'vehicle', user: 'Dispatch System', detail: 'Vehicle KDK 456P assigned to shipment SHP-2024-1001', ip: '10.0.1.xx', time: '14:15:00' },
  { id: 'AUD-10037', action: 'driver.assign', entity: 'John Kamau', entityType: 'driver', user: 'Dispatch System', detail: 'Driver John Kamau assigned to vehicle KDK 456P', ip: '10.0.1.xx', time: '14:14:58' },
  { id: 'AUD-10036', action: 'lock.unclamp', entity: 'SSL-1190', entityType: 'lock', user: 'Hassan Omar', detail: 'E-Lock unclamped from MSCU7712340 at Mombasa Port. Auth: UC-8834', ip: '197.232.xx.xx', time: '12:10:45' },
  { id: 'AUD-10035', action: 'shipment.delivered', entity: 'SHP-2024-0990', entityType: 'shipment', user: 'Hassan Omar', detail: 'Delivery confirmed for MSCU7712340 at EPZ yard', ip: '197.232.xx.xx', time: '12:10:42' },
  { id: 'AUD-10034', action: 'alert.ack', entity: 'ALT-0038', entityType: 'alert', user: 'David Kibet', detail: 'Overspeed alert acknowledged for KCE 771D', ip: '196.201.xx.xx', time: '11:45:30' },
  { id: 'AUD-10033', action: 'geofence.exit', entity: 'KDG 330F', entityType: 'vehicle', user: 'System', detail: 'Vehicle exited Nakuru-Mombasa corridor geofence', ip: '10.0.1.xx', time: '11:05:12' },
  { id: 'AUD-10032', action: 'user.login', entity: 'Dr. Agnes Muthoni', entityType: 'user', user: 'Dr. Agnes Muthoni', detail: 'Login from Chrome/Windows', ip: '41.89.xx.xx', time: '10:30:00' },
];

const actionColors: Record<string, string> = {
  lock: '#ffb020',
  shipment: '#ff7a00',
  vehicle: '#33d6a8',
  driver: '#33d6a8',
  alert: '#ff5c5c',
  user: '#6b7380',
  geofence: '#ffb020',
};

export default function AuditLogs() {
  const [search, setSearch] = useState('');
  const filtered = search
    ? auditLogs.filter((l) => l.action.includes(search.toLowerCase()) || l.detail.toLowerCase().includes(search.toLowerCase()) || l.user.toLowerCase().includes(search.toLowerCase()))
    : auditLogs;

  return (
    <div className="p-6 pb-10 animate-fade-in">
      <PageHeader
        title="Audit Logs"
        description="Complete operational audit trail. Every action is recorded."
        actions={
          <Button variant="ghost" icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" /></svg>}>
            Export
          </Button>
        }
      />

      <div className="mt-4 mb-3">
        <SearchInput value={search} onChange={setSearch} placeholder="Search actions, users, entities..." className="max-w-md" />
      </div>

      <div className="glass p-0">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs-tight">
            <thead>
              <tr>
                {['Time', 'Action', 'Entity', 'User', 'Detail', 'IP'].map((h) => (
                  <th key={h} className="text-left font-mono text-2xs tracking-[0.06em] text-text-2 uppercase px-3.5 pb-2.5 pt-3 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((log) => {
                const color = actionColors[log.entityType] ?? '#6b7380';
                return (
                  <tr key={log.id} className="border-t border-hair hover:bg-ink-2 transition-colors">
                    <td className="px-3.5 py-2.5 font-mono text-text-2 text-2xs whitespace-nowrap">{log.time}</td>
                    <td className="px-3.5 py-2.5">
                      <span
                        className="px-2 py-0.5 rounded text-2xs font-mono font-semibold"
                        style={{ background: `${color}18`, color }}
                      >
                        {log.action}
                      </span>
                    </td>
                    <td className="px-3.5 py-2.5 font-mono text-text-0 text-2xs">{log.entity}</td>
                    <td className="px-3.5 py-2.5 text-text-0">{log.user}</td>
                    <td className="px-3.5 py-2.5 text-text-1 max-w-[320px] truncate">{log.detail}</td>
                    <td className="px-3.5 py-2.5 font-mono text-text-2 text-2xs">{log.ip}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-3 border-t border-hair flex items-center justify-between text-2xs text-text-2">
          <span>Showing {filtered.length} of {auditLogs.length} entries</span>
          <div className="flex gap-1">
            <button className="px-2.5 py-1 rounded bg-ink-3 text-text-1 hover:text-text-0 transition-colors">Prev</button>
            <button className="px-2.5 py-1 rounded bg-cds-orange text-white">1</button>
            <button className="px-2.5 py-1 rounded bg-ink-3 text-text-1 hover:text-text-0 transition-colors">2</button>
            <button className="px-2.5 py-1 rounded bg-ink-3 text-text-1 hover:text-text-0 transition-colors">Next</button>
          </div>
        </div>
      </div>
    </div>
  );
}
