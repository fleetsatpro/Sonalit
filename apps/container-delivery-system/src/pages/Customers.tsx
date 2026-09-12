import React from 'react';
import { Badge } from '@/components/ui/Badge.js';
import { Button } from '@/components/ui/Button.js';
import { PageHeader } from '@/components/ui/PageHeader.js';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api.js';

const s = (v: unknown) => String(v ?? '—');

export default function Customers() {
  const { data, isLoading } = useQuery<{ data: Record<string, unknown>[] }>({
    queryKey: ['customers'],
    queryFn: async () => {
      const res = await api.get('/customers');
      return res.data;
    },
  });

  if (isLoading) return <div className="flex items-center justify-center h-64"><div className="text-text-2 font-mono text-xs">Loading…</div></div>;

  const customers = data?.data ?? [];

  return (
    <div className="p-6 pb-10 animate-fade-in">
      <PageHeader
        title="Customers"
        description={`${customers.length} registered customers · ${customers.reduce((a, c) => a + Number(c['active_shipments'] ?? 0), 0)} active shipments`}
        actions={
          <Button icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>}>
            Add Customer
          </Button>
        }
      />

      <div className="glass p-0">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs-tight">
            <thead>
              <tr>
                {['Customer', 'Code', 'Contact', 'City', 'Active', 'Total Shipments', 'SLA %', 'Rating', 'Status'].map((h) => (
                  <th key={h} className="text-left font-mono text-2xs tracking-[0.06em] text-text-2 uppercase px-3.5 pb-2.5 pt-3 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {customers.map((c, i) => (
                <tr key={s(c['code'] ?? c['id'] ?? i)} className="border-t border-hair cursor-pointer hover:bg-ink-2 transition-colors">
                  <td className="px-3.5 py-3 text-text-0 font-semibold">{s(c['name'])}</td>
                  <td className="px-3.5 py-3 font-mono text-text-1">{s(c['code'])}</td>
                  <td className="px-3.5 py-3 text-text-0">{s(c['contact'])}<div className="text-2xs text-text-2 mt-0.5">{s(c['phone'])}</div></td>
                  <td className="px-3.5 py-3 text-text-0">{s(c['city'])}</td>
                  <td className="px-3.5 py-3 font-mono text-text-0">{s(c['active_shipments'])}</td>
                  <td className="px-3.5 py-3 font-mono text-text-0">{s(c['total_shipments'])}</td>
                  <td className="px-3.5 py-3 font-mono text-text-0">{s(c['sla'])}%</td>
                  <td className="px-3.5 py-3 font-mono text-text-0">{s(c['rating'])}</td>
                  <td className="px-3.5 py-3"><Badge variant="ok">{String(c['status'] ?? 'active').toUpperCase()}</Badge></td>
                </tr>
              ))}
              {customers.length === 0 && <tr><td colSpan={9} className="px-3.5 py-8 text-center text-text-2">No customers found.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
