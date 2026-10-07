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
  /** Starred by the user: kept instead of being deleted after it's read. */
  starred?: boolean;
  /** When it will be deleted (12 hours after it's read, unless starred). */
  expiresAt?: string | null;
  createdAt: string;
}

/** The API deletes a notification this many hours after it's marked read (mirrors NOTIFICATION_READ_TTL_HOURS). */
export const READ_NOTIFICATION_TTL_HOURS = 12;

/** "Starred · kept" / "Deletes in 3h" / "Deletes in 40m" — null while unread and unstarred. */
export const keepLabel = (n: Pick<NotificationItem, 'starred' | 'expiresAt'>, now = Date.now()) => {
  if (n.starred) return 'Starred · kept';
  if (!n.expiresAt) return null;
  const left = new Date(n.expiresAt).getTime() - now;
  if (left <= 0) return 'Deleting soon';
  return left >= 3_600_000 ? `Deletes in ${Math.floor(left / 3_600_000)}h` : `Deletes in ${Math.max(1, Math.floor(left / 60_000))}m`;
};

/** Everything notification-related lives under this namespace (the header bell uses it too). */
export const notificationKeys = {
  all: ['notifications'] as const,
  list: (q: object) => ['notifications', 'list', q] as const,
};

export const useNotifications = (query: { page: number; limit: number; unread?: boolean; starred?: boolean }) =>
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

/** Star (keep) or unstar one of my notifications. */
export const useStarNotification = () => {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, starred }: { id: string; starred: boolean }) => post<NotificationItem>(`/notifications/${id}/star`, { starred }),
    onSuccess: () => void invalidate(),
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
