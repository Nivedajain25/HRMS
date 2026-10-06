import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { get, post } from '@/lib/api';
import { useInfiniteList } from '@/features/profile/kit/infinite';

/* Same shapes as the web `features/announcements/api.ts`. */

export type AnnouncementPriority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';

export interface AnnouncementAttachment {
  _id: string;
  title?: string;
  originalName?: string;
  mimeType?: string;
  size?: number;
}

export interface Announcement {
  _id: string;
  title: string;
  /** HTML sanitized by the server with an allowlist. */
  content: string;
  priority: AnnouncementPriority;
  audience: 'ALL' | 'DEPARTMENTS' | 'EMPLOYEES';
  attachmentIds: AnnouncementAttachment[];
  publishAt: string;
  expiresAt?: string | null;
  pinned: boolean;
  createdBy?: { _id: string; firstName: string; lastName: string; avatar?: string | null } | null;
  createdAt: string;
  status?: 'PUBLISHED' | 'SCHEDULED' | 'EXPIRED';
  read: boolean;
}

export const announcementKeys = {
  all: ['announcements'] as const,
  list: (q: object) => ['announcements', 'list', q] as const,
  detail: (id: string) => ['announcements', 'detail', id] as const,
  unread: ['announcements', 'unread'] as const,
  highlights: ['announcements', 'highlights'] as const,
};

export interface AnnouncementHighlight extends Announcement {
  /** Plain-text excerpt. */
  excerpt: string;
}

/**
 * `popup`: unread recent announcements to show once (most urgent first). Polled every 15 s so a new
 * announcement pops up almost immediately while the app is open (and right after sign-in).
 */
export const useAnnouncementHighlights = (enabled = true) =>
  useQuery({
    queryKey: announcementKeys.highlights,
    queryFn: () => get<{ popup: AnnouncementHighlight[]; bar: AnnouncementHighlight[]; unreadTotal: number }>('/announcements/highlights'),
    enabled,
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
    staleTime: 10_000,
  });

/** Published announcements for me, pinned first. */
export const useAnnouncementFeed = () => useInfiniteList<Announcement>(announcementKeys.list({}), '/announcements', {}, { limit: 15 });

/**
 * Unread announcements among the latest 50 (there is no unread-count endpoint);
 * `capped` is true when every one of them is unread.
 */
export const useUnreadAnnouncements = () =>
  useQuery({
    queryKey: announcementKeys.unread,
    queryFn: async () => {
      const res = await get<Announcement[]>('/announcements', { page: 1, limit: 50 });
      const unread = res.filter((a) => !a.read).length;
      return { count: unread, capped: unread === 50 };
    },
    staleTime: 60_000,
  });

export const useAnnouncement = (id: string | undefined) =>
  useQuery({ queryKey: announcementKeys.detail(id ?? ''), queryFn: () => get<Announcement>(`/announcements/${id}`), enabled: !!id });

export const useMarkAnnouncementRead = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => post<{ read: boolean }>(`/announcements/${id}/read`),
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: announcementKeys.all, predicate: (q) => q.queryKey[1] !== 'detail' }),
        // Dashboards embed the latest announcements with their read state.
        qc.invalidateQueries({ queryKey: ['dashboard'] }),
      ]),
  });
};

export const attachmentName = (a: AnnouncementAttachment) => a.title || a.originalName || 'Attachment';
