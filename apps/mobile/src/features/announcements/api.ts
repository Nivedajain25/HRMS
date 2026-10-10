import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { del, get, post } from '@/lib/api';
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
  /** The caller posted it, or is HR: may delete it. */
  canEdit?: boolean;
}

export type AnnouncementAudience = Announcement['audience'];

export interface NewAnnouncement {
  title: string;
  /** HTML (the server sanitizes it). */
  content: string;
  priority: AnnouncementPriority;
  audience: AnnouncementAudience;
  departmentIds?: string[];
  employeeIds?: string[];
  pinned?: boolean;
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

/** Departments for the announcement audience picker. */
export const useDepartments = (enabled = true) =>
  useQuery({ queryKey: ['departments', 'all'], queryFn: () => get<{ _id: string; name: string }[]>('/departments/all'), enabled, staleTime: 5 * 60_000 });

const useInvalidateAnnouncements = () => {
  const qc = useQueryClient();
  return () => Promise.all([qc.invalidateQueries({ queryKey: announcementKeys.all }), qc.invalidateQueries({ queryKey: ['dashboard'] })]);
};

/** Anyone can post an announcement; the audience gets a push notification and the pop-up. */
export const useCreateAnnouncement = () => {
  const invalidate = useInvalidateAnnouncements();
  return useMutation({ mutationFn: async (body: NewAnnouncement) => (await post<Announcement>('/announcements', body)).data, onSuccess: () => invalidate() });
};

/** The author (or HR) can delete an announcement. */
export const useDeleteAnnouncement = () => {
  const invalidate = useInvalidateAnnouncements();
  return useMutation({ mutationFn: (id: string) => del<null>(`/announcements/${id}`), onSuccess: () => invalidate() });
};

const escapeHtml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Plain text typed on the phone → simple HTML: a blank line starts a new paragraph, single line breaks are kept. */
export const textToHtml = (text: string) =>
  text
    .trim()
    .split(/\n\s*\n/)
    .map((para) => `<p>${escapeHtml(para.trim()).replace(/\n/g, '<br>')}</p>`)
    .join('');
