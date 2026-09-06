import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api.js';
import type { DashboardKPI, ActivityItem } from '@/types/index.js';

interface DashboardData {
  kpis: DashboardKPI[];
  recentActivity: ActivityItem[];
  activeShipments: number;
  activeContainers: number;
  activeLocks: number;
  offlineLocks: number;
  delayedShipments: number;
  deliveredToday: number;
}

export function useDashboard() {
  return useQuery<DashboardData>({
    queryKey: ['dashboard'],
    queryFn: async () => {
      const { data } = await api.get('/dashboard');
      return data;
    },
    refetchInterval: 30_000,
  });
}

export function useActivityFeed() {
  return useQuery<ActivityItem[]>({
    queryKey: ['activity-feed'],
    queryFn: async () => {
      const { data } = await api.get('/activity');
      return data;
    },
    refetchInterval: 15_000,
  });
}
