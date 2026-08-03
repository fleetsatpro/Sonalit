// Notifications Hook

import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '../store/auth';

interface Notification {
  id: string;
  title: string;
  message: string;
  type: string;
  read: boolean;
  createdAt: string;
  data?: Record<string, unknown>;
}

export function useNotifications() {
  const { accessToken } = useAuthStore();

  const { data, refetch } = useQuery<Notification[]>({
    queryKey: ['notifications'],
    queryFn: async () => {
      const response = await fetch('/api/v1/cds/notifications', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
      
      if (!response.ok) {
        throw new Error('Failed to fetch notifications');
      }
      
      const result = await response.json();
      return result.data || [];
    },
    enabled: !!accessToken,
    refetchInterval: 30000, // Refetch every 30 seconds
  });

  const notifications = data || [];
  const unreadCount = notifications.filter((n) => !n.read).length;

  return {
    notifications,
    unreadCount,
    refetch,
  };
}

export function useMarkNotificationRead() {
  const { accessToken } = useAuthStore();

  return async (notificationId: string) => {
    const response = await fetch(`/api/v1/cds/notifications/${notificationId}/read`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      throw new Error('Failed to mark notification as read');
    }
  };
}
