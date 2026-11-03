import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api.js';
import type { ActivityItem } from '@/types/index.js';

interface DashboardSnapshot extends Record<string, unknown> {
  active_containers?: number;
  in_transit?: number;
  delivered_today?: number;
  active_locks?: number;
  locks_removed?: number;
  pending_unclamp?: number;
  delayed_trips?: number;
  avg_transit_hours?: number | null;
  total_trips?: number;
  delivered_total?: number;
  delayed_total?: number;
  unacknowledged_alerts?: number;
  recent_activity?: ActivityItem[];
}

export function useDashboard() {
  return useQuery<DashboardSnapshot>({
    queryKey: ['dashboard'],
    queryFn: async () => {
      const { data: body } = await api.get('/dashboard');
      return (body.data ?? body) as DashboardSnapshot;
    },
    refetchInterval: 30_000,
  });
}

export function useActivityFeed() {
  return useQuery<ActivityItem[]>({
    queryKey: ['activity-feed'],
    queryFn: async () => {
      const { data } = await api.get('/activity');
      return Array.isArray(data) ? data : (Array.isArray(data.data) ? data.data : []);
    },
    refetchInterval: 15_000,
  });
}
