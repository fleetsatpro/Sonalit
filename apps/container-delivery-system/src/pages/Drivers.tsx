import React from 'react';
import { Badge } from '@/components/ui/Badge.js';
import { Button } from '@/components/ui/Button.js';
import { PageHeader } from '@/components/ui/PageHeader.js';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api.js';

const s = (v: unknown) => String(v ?? '—');

export default function Drivers() {
  const { data, isLoading } = useQuery<{ data: Record<string, unknown>[] }>({
    queryKey: ['drivers'],
    queryFn: async () => {
      const res = await api.get('/drivers');
      return res.data;
    },
  });

  if (isLoading) return <div className="flex items-center justify-center h-64"><div className="text-text-2 font-mono text-xs">Loading…</div></div>;

  const drivers = data?.data ?? [];

  return (
    <div className="p-6 pb-10 animate-fade-in">
      <PageHeader
        title="Drivers"
        description={`${drivers.length} registered drivers across all transporters.`}
        actions={
          <Button icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>}>
            Add Driver
          </Button>
        }
      />

      <div className="glass p-0">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs-tight">
            <thead>
              <tr>
                {['Driver', 'Transporter', 'Current Truck', 'Trips', 'Rating', 'Status'].map((h) => (
                  <th key={h} className="text-left font-mono text-2xs tracking-[0.06em] text-text-2 uppercase px-3.5 pb-2.5 pt-3 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {drivers.map((d, i) => (
                <tr key={s(d['id'] ?? d['name'] ?? i)} className="border-t border-hair cursor-pointer hover:bg-ink-2 transition-colors">
                  <td className="px-3.5 py-3 text-text-0">{s(d['name'])}<div className="text-2xs text-text-2 mt-0.5">{s(d['phone'])}</div></td>
                  <td className="px-3.5 py-3 text-text-0">{s(d['transporter'])}</td>
                  <td className="px-3.5 py-3 font-mono text-text-0">{s(d['truck'])}</td>
                  <td className="px-3.5 py-3 font-mono text-text-0">{s(d['trips'])}</td>
                  <td className="px-3.5 py-3 font-mono text-text-0">{s(d['rating'])}</td>
                  <td className="px-3.5 py-3">{s(d['status']) === 'active' ? <Badge variant="ok">ACTIVE</Badge> : <Badge variant="neutral">IDLE</Badge>}</td>
                </tr>
              ))}
              {drivers.length === 0 && <tr><td colSpan={6} className="px-3.5 py-8 text-center text-text-2">No drivers found.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
