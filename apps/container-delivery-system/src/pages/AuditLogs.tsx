import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/Button.js';
import { PageHeader } from '@/components/ui/PageHeader.js';
import { SearchInput } from '@/components/ui/SearchInput.js';
import { api } from '@/lib/api.js';

const s = (v: unknown) => String(v ?? '—');

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

  const { data, isLoading } = useQuery<{ data: Record<string, unknown>[]; total: number }>({
    queryKey: ['audit-logs'],
    queryFn: async () => {
      const { data } = await api.get('/audit');
      return data;
    },
  });

  if (isLoading) return <div className="flex items-center justify-center h-64"><div className="text-text-2 font-mono text-xs">Loading…</div></div>;

  const rows = data?.data ?? [];
  const filtered = search
    ? rows.filter((l) => s(l.action).includes(search.toLowerCase()) || s(l.details).toLowerCase().includes(search.toLowerCase()) || s(l.user_name).toLowerCase().includes(search.toLowerCase()))
    : rows;

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
                const entityType = s(log.entity_type);
                const color = actionColors[entityType] ?? '#6b7380';
                return (
                  <tr key={s(log.id)} className="border-t border-hair hover:bg-ink-2 transition-colors">
                    <td className="px-3.5 py-2.5 font-mono text-text-2 text-2xs whitespace-nowrap">{s(log.created_at)}</td>
                    <td className="px-3.5 py-2.5">
                      <span
                        className="px-2 py-0.5 rounded text-2xs font-mono font-semibold"
                        style={{ background: `${color}18`, color }}
                      >
                        {s(log.action)}
                      </span>
                    </td>
                    <td className="px-3.5 py-2.5 font-mono text-text-0 text-2xs">{s(log.entity_id)}</td>
                    <td className="px-3.5 py-2.5 text-text-0">{s(log.user_name)}</td>
                    <td className="px-3.5 py-2.5 text-text-1 max-w-[320px] truncate">{s(log.details)}</td>
                    <td className="px-3.5 py-2.5 font-mono text-text-2 text-2xs">{s(log.ip_address)}</td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={6} className="px-3.5 py-8 text-center text-text-2 text-xs">No audit logs found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-3 border-t border-hair flex items-center justify-between text-2xs text-text-2">
          <span>Showing {filtered.length} of {rows.length} entries</span>
        </div>
      </div>
    </div>
  );
}
