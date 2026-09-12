import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card } from '@/components/ui/Card.js';
import { Badge } from '@/components/ui/Badge.js';
import { PageHeader } from '@/components/ui/PageHeader.js';
import { api } from '@/lib/api.js';

const s = (v: unknown) => String(v ?? '—');

export default function AIInbox() {
  const { data, isLoading } = useQuery<Record<string, unknown>[]>({
    queryKey: ['activity-feed'],
    queryFn: async () => {
      const { data } = await api.get('/activity');
      return data;
    },
    refetchInterval: 15_000,
  });

  if (isLoading) return <div className="flex items-center justify-center h-64"><div className="text-text-2 font-mono text-xs">Loading…</div></div>;

  const activities: Record<string, unknown>[] = Array.isArray(data) ? data : (data as Record<string, unknown>)?.data as Record<string, unknown>[] ?? [];

  return (
    <div className="p-6 pb-10 animate-fade-in h-[calc(100vh-64px)]">
      <PageHeader
        title="AI Inbox"
        description="Activity feed and operational messages"
        actions={
          <Badge variant="neutral">{activities.length} ITEMS</Badge>
        }
      />

      <div className="grid grid-cols-1 gap-0 h-[calc(100%-48px)]">
        <Card className="p-0 overflow-y-auto">
          <div className="divide-y divide-hair">
            {activities.map((item, i) => {
              const action = s(item.action ?? item.type);
              const entity = s(item.entity_type ?? item.entity);
              const detail = s(item.details ?? item.detail ?? item.message ?? item.text);
              const user = s(item.user_name ?? item.user ?? item.actor);
              const time = s(item.created_at ?? item.timestamp ?? item.time);
              return (
                <div key={s(item.id ?? i)} className="flex gap-3 px-4 py-3.5 hover:bg-ink-2 transition-colors">
                  <div className="w-[30px] h-[30px] rounded-lg flex-none flex items-center justify-center bg-ink-3 text-cds-orange text-2xs font-bold">
                    {entity.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs-tight font-semibold text-text-0">{user}</span>
                      <span className="px-1.5 py-0.5 rounded bg-ink-3 text-[9.5px] font-mono text-text-2">{action}</span>
                      <span className="text-2xs font-mono text-text-2 ml-auto flex-none">{time}</span>
                    </div>
                    <div className="text-2xs text-text-1 mt-0.5 truncate">{detail}</div>
                    {entity !== '—' && (
                      <div className="text-2xs text-text-2 font-mono mt-0.5">{entity} {s(item.entity_id)}</div>
                    )}
                  </div>
                </div>
              );
            })}
            {activities.length === 0 && (
              <div className="flex items-center justify-center h-40 text-text-2 text-xs font-mono">No activity yet.</div>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
