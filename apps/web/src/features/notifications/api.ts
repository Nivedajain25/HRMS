import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { NotificationType } from '@stencil/shared';
import { del, getPaged, post } from '@/lib/api';

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

/** Everything notification-related lives under this namespace (the header bell uses it too). */
export const notificationKeys = {
  all: ['notifications'] as const,
  list: (q: object) => ['notifications', 'list', q] as const,
};

export const useNotifications = (query: { page: number; limit: number; unread?: boolean }) =>
  useQuery({
    queryKey: notificationKeys.list(query),
    queryFn: () => getPaged<NotificationItem>('/notifications', query),
    placeholderData: keepPreviousData,
  });

const useInvalidate = () => {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: notificationKeys.all });
};

export const useMarkNotificationRead = () => {
  const invalidate = useInvalidate();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => post<NotificationItem>(`/notifications/${id}/read`),
    onSuccess: () => {
      void invalidate();
      // The dashboard's unread counter comes from the dashboard payload.
      void qc.invalidateQueries({ queryKey: ['dashboard', 'employee'] });
    },
  });
};

export const useMarkAllNotificationsRead = () => {
  const invalidate = useInvalidate();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => post<{ updated: number }>('/notifications/read-all'),
    onSuccess: () => {
      void invalidate();
      void qc.invalidateQueries({ queryKey: ['dashboard', 'employee'] });
    },
  });
};

export const useDeleteNotification = () => {
  const invalidate = useInvalidate();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => del(`/notifications/${id}`),
    onSuccess: () => {
      void invalidate();
      void qc.invalidateQueries({ queryKey: ['dashboard', 'employee'] });
    },
  });
};
