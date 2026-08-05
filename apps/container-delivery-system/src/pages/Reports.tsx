import React, { useState } from 'react';
import { Card } from '@/components/ui/Card.js';
import { Badge } from '@/components/ui/Badge.js';
import { Button } from '@/components/ui/Button.js';

const reportTypes = [
  { id: 'daily', name: 'Daily Operations', description: 'Shipment activity, lock events, fleet status for the day', icon: 'D', color: '#ff7a00' },
  { id: 'weekly', name: 'Weekly Summary', description: 'Aggregated performance, trends, and KPIs for the week', icon: 'W', color: '#33d6a8' },
  { id: 'monthly', name: 'Monthly Analytics', description: 'Comprehensive monthly analysis with year-over-year comparisons', icon: 'M', color: '#ffb020' },
  { id: 'customer', name: 'Customer Report', description: 'Per-customer delivery performance, SLA compliance, volume', icon: 'C', color: '#6b7380' },
  { id: 'driver', name: 'Driver Performance', description: 'Trip counts, ratings, on-time rates, incident history', icon: 'DR', color: '#33d6a8' },
  { id: 'vehicle', name: 'Vehicle Utilization', description: 'Fleet usage, maintenance, fuel, odometer, idle time', icon: 'V', color: '#ff7a00' },
  { id: 'lock', name: 'Lock Utilization', description: 'Assignment rates, battery health, signal uptime, tamper events', icon: 'L', color: '#ffb020' },
  { id: 'incident', name: 'Incident Summary', description: 'Open/resolved incidents, response times, root causes', icon: 'I', color: '#ff5c5c' },
  { id: 'audit', name: 'Audit Trail', description: 'Complete action log with user, timestamp, entity, and details', icon: 'A', color: '#6b7380' },
];

const recentReports = [
  { id: 'RPT-0089', name: 'Daily Operations — Jan 15', type: 'daily', format: 'PDF', status: 'ready', generatedBy: 'System', generatedAt: '2024-01-15 23:59', size: '1.8 MB' },
  { id: 'RPT-0088', name: 'Weekly Summary — W02 2024', type: 'weekly', format: 'Excel', status: 'ready', generatedBy: 'System', generatedAt: '2024-01-14 00:05', size: '3.2 MB' },
  { id: 'RPT-0087', name: 'Customer Report — Kenya Coffee Board', type: 'customer', format: 'PDF', status: 'ready', generatedBy: 'Dr. Agnes Muthoni', generatedAt: '2024-01-13 15:30', size: '2.1 MB' },
  { id: 'RPT-0086', name: 'Lock Utilization — December 2023', type: 'lock', format: 'Excel', status: 'ready', generatedBy: 'System', generatedAt: '2024-01-01 00:15', size: '4.5 MB' },
  { id: 'RPT-0085', name: 'Incident Summary — Q4 2023', type: 'incident', format: 'PDF', status: 'ready', generatedBy: 'James Kinuthia', generatedAt: '2024-01-02 10:00', size: '1.4 MB' },
];

const statusVariants: Record<string, 'ok' | 'warn' | 'bad'> = { ready: 'ok', generating: 'warn', failed: 'bad' };

export default function Reports() {
  const [view, setView] = useState<'generate' | 'history'>('generate');

  return (
    <div className="p-6 pb-10 animate-fade-in">
      <div className="flex items-center justify-between mb-1">
        <div>
          <h2 className="font-display font-bold text-[17px] m-0">Reports</h2>
          <p className="text-[12px] text-text-2 m-0 mt-1">Generate, schedule, and download operational reports.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></svg>}>
            Schedule
          </Button>
        </div>
      </div>

      <div className="flex gap-2 mt-4 mb-4">
        {(['generate', 'history'] as const).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`px-3.5 py-1.5 rounded-full text-[12px] font-medium capitalize transition-colors ${view === v ? 'bg-cds-orange text-white' : 'bg-ink-3 text-text-1 hover:text-text-0'}`}
          >
            {v === 'generate' ? 'Generate Report' : `History (${recentReports.length})`}
          </button>
        ))}
      </div>

      {view === 'generate' && (
        <div className="grid grid-cols-3 gap-3">
          {reportTypes.map((rt) => (
            <Card key={rt.id} className="p-4 cursor-pointer hover:bg-ink-3 transition-colors group">
              <div className="flex items-start gap-3">
                <div
                  className="w-[36px] h-[36px] rounded-lg flex items-center justify-center text-[13px] font-bold flex-none"
                  style={{ background: `${rt.color}18`, color: rt.color }}
                >
                  {rt.icon}
                </div>
                <div className="flex-1">
                  <div className="text-[13px] font-semibold text-text-0 group-hover:text-cds-orange transition-colors">{rt.name}</div>
                  <div className="text-[11px] text-text-2 mt-0.5 leading-relaxed">{rt.description}</div>
                </div>
              </div>
              <div className="flex gap-2 mt-3">
                {['PDF', 'Excel', 'CSV'].map((fmt) => (
                  <button key={fmt} className="px-2.5 py-1 rounded bg-ink-3 text-[10px] font-mono text-text-1 hover:text-text-0 hover:bg-ink-4 transition-colors">
                    {fmt}
                  </button>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}

      {view === 'history' && (
        <Card className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[12.5px]">
              <thead>
                <tr>
                  {['Report', 'Type', 'Format', 'Size', 'Generated By', 'Date', 'Status', ''].map((h) => (
                    <th key={h} className="text-left font-mono text-[10px] tracking-[0.06em] text-text-2 uppercase px-3.5 pb-2.5 pt-3 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {recentReports.map((r) => (
                  <tr key={r.id} className="border-t border-hair cursor-pointer hover:bg-ink-2 transition-colors">
                    <td className="px-3.5 py-3 text-text-0 font-medium">{r.name}<div className="text-[10.5px] text-text-2 font-mono mt-0.5">{r.id}</div></td>
                    <td className="px-3.5 py-3 text-text-1 capitalize">{r.type}</td>
                    <td className="px-3.5 py-3 font-mono text-text-1">{r.format}</td>
                    <td className="px-3.5 py-3 font-mono text-text-1">{r.size}</td>
                    <td className="px-3.5 py-3 text-text-0">{r.generatedBy}</td>
                    <td className="px-3.5 py-3 font-mono text-text-2 text-[11px]">{r.generatedAt}</td>
                    <td className="px-3.5 py-3"><Badge variant={statusVariants[r.status] ?? 'neutral'}>{r.status.toUpperCase()}</Badge></td>
                    <td className="px-3.5 py-3">
                      <Button size="sm" variant="ghost">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" /></svg>
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
