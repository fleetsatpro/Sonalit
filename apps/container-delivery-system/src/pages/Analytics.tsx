import React from 'react';
import { Card } from '@/components/ui/Card.js';
import { PageHeader } from '@/components/ui/PageHeader.js';

const deliveryData = [
  { month: 'Aug', delivered: 142, delayed: 8 },
  { month: 'Sep', delivered: 158, delayed: 12 },
  { month: 'Oct', delivered: 171, delayed: 6 },
  { month: 'Nov', delivered: 165, delayed: 10 },
  { month: 'Dec', delivered: 189, delayed: 14 },
  { month: 'Jan', delivered: 145, delayed: 7 },
];

const fleetUtil = [
  { label: 'In Use', value: 62, color: '#ff7a00' },
  { label: 'Available', value: 22, color: '#33d6a8' },
  { label: 'Maintenance', value: 10, color: '#ffb020' },
  { label: 'Idle', value: 6, color: '#6b7380' },
];

const lockHealth = [
  { label: 'Healthy', value: 78, color: '#33d6a8' },
  { label: 'Low Battery', value: 12, color: '#ffb020' },
  { label: 'Offline', value: 6, color: '#ff5c5c' },
  { label: 'Tampered', value: 4, color: '#ff5c5c' },
];

const routePerformance = [
  { route: 'Nakuru → Mombasa', trips: 89, avgTime: '6h 20m', onTime: 94, score: 4.8 },
  { route: 'Naivasha → JKIA', trips: 42, avgTime: '2h 45m', onTime: 88, score: 4.5 },
  { route: 'Eldoret → Mombasa', trips: 34, avgTime: '9h 10m', onTime: 91, score: 4.6 },
  { route: 'Thika → Mombasa', trips: 28, avgTime: '7h 30m', onTime: 96, score: 4.9 },
  { route: 'Kericho → Mombasa', trips: 22, avgTime: '8h 45m', onTime: 82, score: 4.2 },
];

const maxDelivered = Math.max(...deliveryData.map((d) => d.delivered));

function DonutChart({ data, size = 140 }: { data: { label: string; value: number; color: string }[]; size?: number }) {
  const total = data.reduce((a, d) => a + d.value, 0);
  const r = (size - 16) / 2;
  const c = Math.PI * 2 * r;
  let offset = 0;

  return (
    <div className="flex items-center gap-4">
      <svg width={size} height={size} className="transform -rotate-90">
        {data.map((d) => {
          const segLen = (d.value / total) * c;
          const segment = (
            <circle
              key={d.label}
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke={d.color}
              strokeWidth="14"
              strokeDasharray={`${segLen} ${c - segLen}`}
              strokeDashoffset={-offset}
            />
          );
          offset += segLen;
          return segment;
        })}
      </svg>
      <div className="space-y-1.5">
        {data.map((d) => (
          <div key={d.label} className="flex items-center gap-2 text-2xs">
            <span className="w-2 h-2 rounded-full flex-none" style={{ background: d.color }} />
            <span className="text-text-1">{d.label}</span>
            <span className="font-mono text-text-0 ml-auto">{d.value}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Analytics() {
  return (
    <div className="p-6 pb-10 animate-fade-in">
      <PageHeader
        title="Analytics"
        description="Fleet performance, delivery trends, and operational insights — last 30 days."
      />

      <div className="grid grid-cols-4 gap-3 mb-4">
        {[
          { label: 'Total Deliveries', value: '245', delta: '+12%', up: true },
          { label: 'On-Time Rate', value: '93.8%', delta: '+2.1%', up: true },
          { label: 'Avg Transit Time', value: '6h 42m', delta: '-18m', up: true },
          { label: 'Incidents', value: '7', delta: '-3', up: true },
        ].map((kpi) => (
          <Card key={kpi.label} className="p-3.5">
            <div className="text-2xs font-mono text-text-2 uppercase tracking-wider">{kpi.label}</div>
            <div className="text-[22px] font-display font-bold text-text-0 mt-1">{kpi.value}</div>
            <div className={`text-2xs font-mono mt-0.5 ${kpi.up ? 'text-cds-teal' : 'text-cds-red'}`}>{kpi.delta} vs prev period</div>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-4 mb-4">
        <Card className="p-4">
          <div className="font-display font-bold text-sm-tight mb-3">Delivery Trends (6 months)</div>
          <div className="flex items-end gap-2 h-[160px]">
            {deliveryData.map((d) => (
              <div key={d.month} className="flex-1 flex flex-col items-center gap-1">
                <div className="w-full flex flex-col items-center gap-0.5" style={{ height: '140px', justifyContent: 'flex-end' }}>
                  <div
                    className="w-full rounded-t bg-cds-orange transition-all"
                    style={{ height: `${(d.delivered / maxDelivered) * 120}px` }}
                  />
                  <div
                    className="w-full rounded-t bg-cds-red"
                    style={{ height: `${(d.delayed / maxDelivered) * 120}px` }}
                  />
                </div>
                <span className="text-2xs font-mono text-text-2">{d.month}</span>
              </div>
            ))}
          </div>
          <div className="flex gap-4 mt-3 text-2xs font-mono text-text-1">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded bg-cds-orange" />Delivered</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded bg-cds-red" />Delayed</span>
          </div>
        </Card>

        <Card className="p-4">
          <div className="font-display font-bold text-sm-tight mb-4">Fleet Utilization</div>
          <DonutChart data={fleetUtil} />
        </Card>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-4">
        <Card className="p-4">
          <div className="font-display font-bold text-sm-tight mb-4">Lock Health Distribution</div>
          <DonutChart data={lockHealth} />
        </Card>

        <Card className="p-4">
          <div className="font-display font-bold text-sm-tight mb-3">Route Performance</div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-xs-tight">
              <thead>
                <tr>
                  {['Route', 'Trips', 'Avg Time', 'On-Time', 'Score'].map((h) => (
                    <th key={h} className="text-left font-mono text-2xs tracking-wider text-text-2 uppercase pb-2 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {routePerformance.map((r) => (
                  <tr key={r.route} className="border-t border-hair">
                    <td className="py-2 text-text-0 font-medium">{r.route}</td>
                    <td className="py-2 font-mono text-text-1">{r.trips}</td>
                    <td className="py-2 font-mono text-text-1">{r.avgTime}</td>
                    <td className="py-2 font-mono">
                      <span className={r.onTime >= 90 ? 'text-cds-teal' : r.onTime >= 80 ? 'text-cds-amber' : 'text-cds-red'}>{r.onTime}%</span>
                    </td>
                    <td className="py-2 font-mono text-text-0">★ {r.score}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}
