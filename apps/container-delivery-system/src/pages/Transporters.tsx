import React from 'react';
import { Button } from '@/components/ui/Button.js';
import { ProgressBar } from '@/components/ui/ProgressBar.js';
import { PageHeader } from '@/components/ui/PageHeader.js';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api.js';

const s = (v: unknown) => String(v ?? '—');

export default function Transporters() {
  const { data, isLoading } = useQuery<{ data: Record<string, unknown>[] }>({
    queryKey: ['transporters'],
    queryFn: async () => {
      const res = await api.get('/transporters');
      return res.data;
    },
  });

  if (isLoading) return <div className="flex items-center justify-center h-64"><div className="text-text-2 font-mono text-xs">Loading…</div></div>;

  const transporters = data?.data ?? [];

  return (
    <div className="p-6 pb-10 animate-fade-in">
      <PageHeader
        title="Transporters"
        description={`Performance across ${transporters.length} contracted transport companies.`}
        actions={
          <Button icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>}>
            Add Transporter
          </Button>
        }
      />

      <div className="glass p-0">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs-tight">
            <thead>
              <tr>
                {['Transporter', 'Contact', 'Active Trucks', 'On-Time Rate', 'Avg Clamp Time', 'Trips (30d)', 'Rating'].map((h) => (
                  <th key={h} className="text-left font-mono text-2xs tracking-[0.06em] text-text-2 uppercase px-3.5 pb-2.5 pt-3 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {transporters.map((t, i) => {
                const onTime = Number(t['on_time'] ?? 0);
                return (
                  <tr key={s(t['name'] ?? t['id'] ?? i)} className="border-t border-hair cursor-pointer hover:bg-ink-2 transition-colors">
                    <td className="px-3.5 py-3 text-text-0 font-semibold">{s(t['name'])}</td>
                    <td className="px-3.5 py-3 text-text-0">{s(t['contact'])}<div className="text-2xs text-text-2 mt-0.5">{s(t['phone'])}</div></td>
                    <td className="px-3.5 py-3 font-mono text-text-0">{s(t['trucks'])}</td>
                    <td className="px-3.5 py-3">
                      <ProgressBar value={onTime} width="w-[70px]" color={onTime >= 90 ? 'bg-cds-teal' : onTime >= 80 ? 'bg-cds-amber' : 'bg-cds-red'} showLabel />
                    </td>
                    <td className="px-3.5 py-3 font-mono text-text-0">{s(t['avg_clamp'])}</td>
                    <td className="px-3.5 py-3 font-mono text-text-0">{s(t['trips'])}</td>
                    <td className="px-3.5 py-3 font-mono text-text-0">{s(t['rating'])}</td>
                  </tr>
                );
              })}
              {transporters.length === 0 && <tr><td colSpan={7} className="px-3.5 py-8 text-center text-text-2">No transporters found.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
