import React, { useState } from 'react';
import { Card } from '@/components/ui/Card.js';
import { Badge, StatusBadge } from '@/components/ui/Badge.js';
import { Button } from '@/components/ui/Button.js';

type Tab = 'queue' | 'completed' | 'returned';

const queueItems = [
  { id: 'TGHU3456789', customer: 'Kenya Coffee Board', container: 'TGHU 345678-9', truck: 'KDK 456P', driver: 'John Kamau', arrivalTime: '14:22', waitTime: '2h 18m', bay: 'Bay 3', status: 'awaiting_unclamp' },
  { id: 'OOCL2261890', customer: 'KTDA Holdings', container: 'OOCL 226189-0', truck: 'KDG 330F', driver: 'Alice Njeri', arrivalTime: '15:05', waitTime: '1h 35m', bay: 'Bay 7', status: 'unclamping' },
  { id: 'HLXU9903312', customer: 'Sian Roses', container: 'HLXU 990331-2', truck: 'KCE 771D', driver: 'Samuel Kiptoo', arrivalTime: '15:40', waitTime: '0h 58m', bay: 'Queued', status: 'awaiting_bay' },
  { id: 'EGLV1129003', customer: 'Kakuzi PLC', container: 'EGLV 112900-3', truck: 'KDF 887M', driver: 'Faith Chebet', arrivalTime: '16:10', waitTime: '0h 30m', bay: 'Queued', status: 'awaiting_bay' },
];

const completedItems = [
  { id: 'MSCU7712340', customer: 'EPZ Textiles', container: 'MSCU 771234-0', completedAt: '12:45', duration: '45m', bay: 'Bay 3', status: 'delivered' },
  { id: 'CSNU8834221', customer: 'Sasini PLC', container: 'CSNU 883422-1', completedAt: '11:20', duration: '38m', bay: 'Bay 5', status: 'delivered' },
  { id: 'TCLU4459008', customer: 'Kenya Coffee Board', container: 'TCLU 445900-8', completedAt: '09:55', duration: '52m', bay: 'Bay 1', status: 'delivered' },
];

const statusLabels: Record<string, { label: string; variant: 'ok' | 'warn' | 'neutral' }> = {
  awaiting_unclamp: { label: 'AWAITING UNCLAMP', variant: 'warn' },
  unclamping: { label: 'UNCLAMPING', variant: 'ok' },
  awaiting_bay: { label: 'QUEUED', variant: 'neutral' },
  delivered: { label: 'DELIVERED', variant: 'ok' },
};

export default function DeliveryOperations() {
  const [tab, setTab] = useState<Tab>('queue');

  return (
    <div className="p-6 pb-10 animate-fade-in">
      <div className="flex items-center justify-between mb-1">
        <div>
          <h2 className="font-display font-bold text-[17px] m-0">Delivery Operations</h2>
          <p className="text-[12px] text-text-2 m-0 mt-1">Port & destination unclamp queue, bay assignment, and delivery confirmation.</p>
        </div>
        <Button icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>}>
          Manual Entry
        </Button>
      </div>

      <div className="grid grid-cols-4 gap-3 mt-4">
        {[
          { label: 'In Queue', value: queueItems.length.toString(), color: 'text-cds-orange' },
          { label: 'Avg Wait', value: '1h 20m', color: 'text-cds-amber' },
          { label: 'Completed Today', value: completedItems.length.toString(), color: 'text-cds-teal' },
          { label: 'Bays Active', value: '3 / 8', color: 'text-text-0' },
        ].map((kpi) => (
          <Card key={kpi.label} className="p-3.5">
            <div className="text-[10px] font-mono text-text-2 uppercase tracking-wider">{kpi.label}</div>
            <div className={`text-[22px] font-display font-bold mt-1 ${kpi.color}`}>{kpi.value}</div>
          </Card>
        ))}
      </div>

      <div className="flex gap-2 mt-5 mb-3">
        {(['queue', 'completed', 'returned'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3.5 py-1.5 rounded-full text-[12px] font-medium transition-colors ${tab === t ? 'bg-cds-orange text-white' : 'bg-ink-3 text-text-1 hover:text-text-0'}`}
          >
            {t === 'queue' ? `Queue (${queueItems.length})` : t === 'completed' ? `Completed (${completedItems.length})` : 'Returns (0)'}
          </button>
        ))}
      </div>

      <Card className="p-0">
        <div className="overflow-x-auto">
          {tab === 'queue' && (
            <table className="w-full border-collapse text-[12.5px]">
              <thead>
                <tr>
                  {['Container', 'Customer', 'Truck / Driver', 'Arrival', 'Wait Time', 'Bay', 'Status', 'Actions'].map((h) => (
                    <th key={h} className="text-left font-mono text-[10px] tracking-[0.06em] text-text-2 uppercase px-3.5 pb-2.5 pt-3 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {queueItems.map((q) => {
                  const s = statusLabels[q.status];
                  return (
                    <tr key={q.id} className="border-t border-hair cursor-pointer hover:bg-ink-2 transition-colors">
                      <td className="px-3.5 py-3 font-mono font-semibold text-text-0">{q.container}</td>
                      <td className="px-3.5 py-3 text-text-0">{q.customer}</td>
                      <td className="px-3.5 py-3 text-text-0">{q.truck}<div className="text-[10.5px] text-text-2 mt-0.5">{q.driver}</div></td>
                      <td className="px-3.5 py-3 font-mono text-text-1">{q.arrivalTime}</td>
                      <td className="px-3.5 py-3 font-mono text-cds-amber">{q.waitTime}</td>
                      <td className="px-3.5 py-3 font-mono text-text-0">{q.bay}</td>
                      <td className="px-3.5 py-3"><Badge variant={s.variant}>{s.label}</Badge></td>
                      <td className="px-3.5 py-3">
                        <div className="flex gap-1.5">
                          {q.status === 'awaiting_bay' && <Button size="sm">Assign Bay</Button>}
                          {q.status === 'awaiting_unclamp' && <Button size="sm" variant="success">Authorize Unclamp</Button>}
                          {q.status === 'unclamping' && <Button size="sm" variant="success">Confirm Delivery</Button>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          {tab === 'completed' && (
            <table className="w-full border-collapse text-[12.5px]">
              <thead>
                <tr>
                  {['Container', 'Customer', 'Completed At', 'Duration', 'Bay', 'Status'].map((h) => (
                    <th key={h} className="text-left font-mono text-[10px] tracking-[0.06em] text-text-2 uppercase px-3.5 pb-2.5 pt-3 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {completedItems.map((c) => (
                  <tr key={c.id} className="border-t border-hair cursor-pointer hover:bg-ink-2 transition-colors">
                    <td className="px-3.5 py-3 font-mono font-semibold text-text-0">{c.container}</td>
                    <td className="px-3.5 py-3 text-text-0">{c.customer}</td>
                    <td className="px-3.5 py-3 font-mono text-text-1">{c.completedAt}</td>
                    <td className="px-3.5 py-3 font-mono text-cds-teal">{c.duration}</td>
                    <td className="px-3.5 py-3 font-mono text-text-0">{c.bay}</td>
                    <td className="px-3.5 py-3"><Badge variant="ok">DELIVERED</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {tab === 'returned' && (
            <div className="flex items-center justify-center h-40 text-text-2 text-[13px]">No pending container returns.</div>
          )}
        </div>
      </Card>
    </div>
  );
}
