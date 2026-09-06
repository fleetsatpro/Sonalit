import React from 'react';
import { Badge } from '@/components/ui/Badge.js';
import { Button } from '@/components/ui/Button.js';
import { ProgressBar } from '@/components/ui/ProgressBar.js';
import { PageHeader } from '@/components/ui/PageHeader.js';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api.js';

const s = (v: unknown) => String(v ?? '—');

export default function Vehicles() {
  const { data, isLoading } = useQuery<{ data: Record<string, unknown>[] }>({
    queryKey: ['vehicles'],
    queryFn: async () => {
      const res = await api.get('/vehicles');
      return res.data;
    },
  });

  if (isLoading) return <div className="flex items-center justify-center h-64"><div className="text-text-2 font-mono text-xs">Loading…</div></div>;

  const vehicles = data?.data ?? [];

  return (
    <div className="p-6 pb-10 animate-fade-in">
      <PageHeader
        title="Vehicles"
        description={`${vehicles.length} vehicles in fleet · ${vehicles.filter((v) => s(v['status']) === 'in_use').length} active · ${vehicles.filter((v) => s(v['status']) === 'maintenance').length} in maintenance`}
        actions={
          <Button icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>}>
            Add Vehicle
          </Button>
        }
      />

      <div className="glass p-0">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs-tight">
            <thead>
              <tr>
                {['Registration', 'Make / Model', 'Year', 'Transporter', 'Driver', 'Odometer', 'Fuel', 'Status'].map((h) => (
                  <th key={h} className="text-left font-mono text-2xs tracking-[0.06em] text-text-2 uppercase px-3.5 pb-2.5 pt-3 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {vehicles.map((v, i) => {
                const fuelLevel = Number(v['fuel_level'] ?? 0);
                const status = s(v['status']);
                return (
                  <tr key={s(v['reg'] ?? v['registration'] ?? i)} className="border-t border-hair cursor-pointer hover:bg-ink-2 transition-colors">
                    <td className="px-3.5 py-3 font-mono font-semibold text-text-0">{s(v['reg'] ?? v['registration'])}</td>
                    <td className="px-3.5 py-3 text-text-0">{s(v['make'])} {s(v['model'])}</td>
                    <td className="px-3.5 py-3 font-mono text-text-1">{s(v['year'])}</td>
                    <td className="px-3.5 py-3 text-text-0">{s(v['transporter'])}</td>
                    <td className="px-3.5 py-3 text-text-0">{v['driver'] ? s(v['driver']) : <span className="text-text-2">Unassigned</span>}</td>
                    <td className="px-3.5 py-3 font-mono text-text-1">{Number(v['odometer'] ?? 0).toLocaleString()} km</td>
                    <td className="px-3.5 py-3">
                      <ProgressBar value={fuelLevel} color={fuelLevel >= 50 ? 'bg-cds-teal' : fuelLevel >= 25 ? 'bg-cds-amber' : 'bg-cds-red'} showLabel />
                    </td>
                    <td className="px-3.5 py-3">
                      {status === 'in_use' ? <Badge variant="ok">IN USE</Badge> : status === 'available' ? <Badge variant="neutral">AVAILABLE</Badge> : <Badge variant="warn">MAINTENANCE</Badge>}
                    </td>
                  </tr>
                );
              })}
              {vehicles.length === 0 && <tr><td colSpan={8} className="px-3.5 py-8 text-center text-text-2">No vehicles found.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
