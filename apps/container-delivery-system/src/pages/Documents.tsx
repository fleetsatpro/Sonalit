import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Badge } from '@/components/ui/Badge.js';
import { Button } from '@/components/ui/Button.js';
import { Tabs } from '@/components/ui/Tabs.js';
import { PageHeader } from '@/components/ui/PageHeader.js';
import { api } from '@/lib/api.js';

type DocFilter = 'all' | 'shipping' | 'customs' | 'inspection' | 'insurance';

const s = (v: unknown) => String(v ?? '—');

const typeIcons: Record<string, string> = { shipping: 'S', customs: 'C', inspection: 'I', insurance: 'N' };
const typeColors: Record<string, string> = { shipping: '#ff7a00', customs: '#33d6a8', inspection: '#ffb020', insurance: '#6b7380' };
const statusVariants: Record<string, 'ok' | 'warn' | 'neutral' | 'bad'> = { verified: 'ok', pending: 'warn', expired: 'bad', rejected: 'bad' };

export default function Documents() {
  const [filter, setFilter] = useState<DocFilter>('all');

  const { data, isLoading } = useQuery<{ data: Record<string, unknown>[]; total: number }>({
    queryKey: ['documents'],
    queryFn: async () => {
      const { data } = await api.get('/documents');
      return data;
    },
  });

  if (isLoading) return <div className="flex items-center justify-center h-64"><div className="text-text-2 font-mono text-xs">Loading…</div></div>;

  const rows = data?.data ?? [];
  const filtered = filter === 'all' ? rows : rows.filter((d) => s(d.type) === filter);
  const pendingCount = rows.filter((d) => s(d.type) === 'pending').length;

  return (
    <div className="p-6 pb-10 animate-fade-in">
      <PageHeader
        title="Documents"
        description={`${rows.length} documents${pendingCount > 0 ? ` · ${pendingCount} pending verification` : ''}`}
        actions={
          <Button icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" /></svg>}>
            Upload Document
          </Button>
        }
      />

      <Tabs
        tabs={[
          { id: 'all', label: 'All', count: rows.length },
          { id: 'shipping', label: 'Shipping' },
          { id: 'customs', label: 'Customs' },
          { id: 'inspection', label: 'Inspection' },
          { id: 'insurance', label: 'Insurance' },
        ]}
        activeId={filter}
        onChange={(id) => setFilter(id as DocFilter)}
        variant="pills"
      />

      <div className="glass p-0 mt-4">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs-tight">
            <thead>
              <tr>
                {['Document', 'Type', 'Shipment', 'Size', 'Uploaded By', 'Date', ''].map((h) => (
                  <th key={h} className="text-left font-mono text-2xs tracking-[0.06em] text-text-2 uppercase px-3.5 pb-2.5 pt-3 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((doc) => {
                const docType = s(doc.type);
                const color = typeColors[docType] ?? '#6b7380';
                const icon = typeIcons[docType] ?? docType.charAt(0).toUpperCase();
                return (
                  <tr key={s(doc.id)} className="border-t border-hair cursor-pointer hover:bg-ink-2 transition-colors">
                    <td className="px-3.5 py-3">
                      <div className="flex items-center gap-2.5">
                        <div
                          className="w-[28px] h-[28px] rounded-lg flex items-center justify-center text-2xs font-bold flex-none"
                          style={{ background: `${color}18`, color }}
                        >
                          {icon}
                        </div>
                        <div>
                          <div className="text-text-0 font-medium">{s(doc.name)}</div>
                          <div className="text-2xs text-text-2 font-mono mt-0.5">{s(doc.id)}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-3.5 py-3 text-text-1 capitalize">{docType}</td>
                    <td className="px-3.5 py-3 font-mono text-text-1">{s(doc.shipment_id)}</td>
                    <td className="px-3.5 py-3 font-mono text-text-1">{s(doc.file_size)}</td>
                    <td className="px-3.5 py-3 text-text-0">{s(doc.uploaded_by)}</td>
                    <td className="px-3.5 py-3 font-mono text-text-2 text-2xs">{s(doc.created_at)}</td>
                    <td className="px-3.5 py-3">
                      <Button size="sm" variant="ghost">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" /></svg>
                      </Button>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={7} className="px-3.5 py-8 text-center text-text-2 text-xs">No documents found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
