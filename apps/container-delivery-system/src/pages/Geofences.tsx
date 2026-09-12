import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card } from '@/components/ui/Card.js';
import { Badge } from '@/components/ui/Badge.js';
import { Button } from '@/components/ui/Button.js';
import { Tabs } from '@/components/ui/Tabs.js';
import { PageHeader } from '@/components/ui/PageHeader.js';
import { api } from '@/lib/api.js';

const s = (v: unknown) => String(v ?? '—');

const categoryColors: Record<string, string> = {
  port: 'text-cds-orange',
  warehouse: 'text-cds-teal',
  border: 'text-cds-amber',
  corridor: 'text-text-1',
};

export default function Geofences() {
  const [filter, setFilter] = useState('all');

  const { data, isLoading } = useQuery<{ data: Record<string, unknown>[]; total: number }>({
    queryKey: ['geofences'],
    queryFn: async () => {
      const { data } = await api.get('/geofences');
      return data;
    },
  });

  if (isLoading) return <div className="flex items-center justify-center h-64"><div className="text-text-2 font-mono text-xs">Loading…</div></div>;

  const rows = data?.data ?? [];
  const filtered = filter === 'all' ? rows : rows.filter((g) => s(g.category) === filter);
  const activeCount = rows.filter((g) => g.active === true).length;

  return (
    <div className="p-6 pb-10 animate-fade-in">
      <PageHeader
        title="Geofences"
        description={`${rows.length} zones configured · ${activeCount} active`}
        actions={
          <Button icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>}>
            Create Geofence
          </Button>
        }
      />

      <div className="grid grid-cols-[1.6fr_1fr] gap-4 items-start">
        <Card className="h-[420px] p-0 relative overflow-hidden">
          <div className="w-full h-full relative" style={{
            background: 'linear-gradient(rgba(255,255,255,0.07) 1px, transparent 1px) 0 0/40px 40px, linear-gradient(90deg, rgba(255,255,255,0.07) 1px, transparent 1px) 0 0/40px 40px, radial-gradient(400px 200px at 50% 50%, rgba(51,214,168,0.06), transparent), #14171b',
          }}>
            <div className="absolute top-3.5 left-4 z-10">
              <div className="font-display font-bold text-[13px]">Geofence Map View</div>
              <div className="text-2xs text-text-2 font-mono">{filtered.length} zones visible</div>
            </div>
            <div className="absolute bottom-3.5 left-4 flex gap-3.5 z-10 text-2xs text-text-1 font-mono">
              <span className="flex items-center gap-[5px]"><span className="w-[7px] h-[7px] rounded-full bg-cds-orange" />Port</span>
              <span className="flex items-center gap-[5px]"><span className="w-[7px] h-[7px] rounded-full bg-cds-teal" />Warehouse</span>
              <span className="flex items-center gap-[5px]"><span className="w-[7px] h-[7px] rounded-full bg-cds-amber" />Checkpoint</span>
            </div>
          </div>
        </Card>

        <div className="space-y-3">
          <Tabs
            tabs={[
              { id: 'all', label: 'All' },
              { id: 'port', label: 'Port' },
              { id: 'warehouse', label: 'Warehouse' },
              { id: 'border', label: 'Border' },
              { id: 'corridor', label: 'Corridor' },
            ]}
            activeId={filter}
            onChange={setFilter}
            variant="pills"
          />

          <div className="space-y-2 max-h-[360px] overflow-y-auto">
            {filtered.map((g) => {
              const category = s(g.category);
              const isActive = g.active === true;
              return (
                <Card key={s(g.id)} hover className="p-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="text-xs-tight font-semibold text-text-0">{s(g.name)}</div>
                      <div className="text-2xs text-text-2 font-mono mt-0.5">
                        <span className={categoryColors[category] ?? 'text-text-1'}>{category.toUpperCase()}</span> · {s(g.type)}
                      </div>
                    </div>
                    {isActive ? <Badge variant="ok">ACTIVE</Badge> : <Badge variant="neutral">OFF</Badge>}
                  </div>
                  <div className="flex items-center justify-between mt-2 text-2xs text-text-2 font-mono">
                    <span>Created {s(g.created_at)}</span>
                  </div>
                </Card>
              );
            })}
            {filtered.length === 0 && (
              <div className="text-center text-text-2 text-xs py-8 font-mono">No geofences found.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
