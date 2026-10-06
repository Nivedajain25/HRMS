import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { NotificationType } from '@stencil/shared';
import { del, get, post, put } from '@/lib/api';
import { useInfiniteList } from '@/features/profile/kit/infinite';

/* Same shapes as the web `features/notifications/api.ts`. */

export interface NotificationItem {
  _id: string;
  type: NotificationType;
  title: string;
  message: string;
  link?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  readAt?: string | null;
  createdAt: string;
}

export interface NotificationPreference {
  type: NotificationType;
  inApp: boolean;
  email: boolean;
}

/** Everything notification-related lives under `['notifications']` (push receipt invalidates it). */
export const notificationKeys = {
  all: ['notifications'] as const,
  list: (q: object) => ['notifications', 'list', q] as const,
  unread: ['notifications', 'unread-count'] as const,
  preferences: ['notifications', 'preferences'] as const,
};

export const useNotifications = (unreadOnly: boolean) => {
  const query = { unread: unreadOnly ? true : undefined };
  return useInfiniteList<NotificationItem>(notificationKeys.list(query), '/notifications', query, { limit: 25 });
};

export const useUnreadCount = () =>
  useQuery({
    queryKey: notificationKeys.unread,
    queryFn: async () => (await get<{ count: number }>('/notifications/unread-count')).count,
    refetchInterval: 60_000,
  });

const useInvalidate = () => {
  const qc = useQueryClient();
  // The Home unread bell comes from the dashboard payload.
  return () => Promise.all([qc.invalidateQueries({ queryKey: notificationKeys.all }), qc.invalidateQueries({ queryKey: ['dashboard', 'employee'] })]);
};

export const useMarkRead = () => {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: (id: string) => post<NotificationItem>(`/notifications/${id}/read`), onSuccess: invalidate });
};

export const useMarkAllRead = () => {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: () => post<{ updated: number }>('/notifications/read-all'), onSuccess: invalidate });
};

export const useDeleteNotification = () => {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: (id: string) => del(`/notifications/${id}`), onSuccess: invalidate });
};

export const useNotificationPreferences = () =>
  useQuery({ queryKey: notificationKeys.preferences, queryFn: () => get<NotificationPreference[]>('/notifications/preferences') });

export const useSaveNotificationPreferences = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (preferences: NotificationPreference[]) => put<NotificationPreference[]>('/notifications/preferences', { preferences }),
    onSuccess: () => qc.invalidateQueries({ queryKey: notificationKeys.preferences }),
  });
};
