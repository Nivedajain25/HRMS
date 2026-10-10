import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AnnouncementInput, AnnouncementUpdateInput } from '@stencil/shared';
import { del, get, getPaged, patch, post, upload } from '@/lib/api';

export type AnnouncementPriority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
export type AnnouncementAudience = 'ALL' | 'DEPARTMENTS' | 'EMPLOYEES';
export type AnnouncementStatus = 'PUBLISHED' | 'SCHEDULED' | 'EXPIRED';

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
  audience: AnnouncementAudience;
  departmentIds: string[];
  employeeIds: string[];
  attachmentIds: AnnouncementAttachment[];
  publishAt: string;
  expiresAt?: string | null;
  pinned: boolean;
  sendEmail: boolean;
  createdBy?: { _id: string; firstName: string; lastName: string; avatar?: string | null } | null;
  createdAt: string;
  updatedAt?: string;
  status: AnnouncementStatus;
  read: boolean;
  /** Only with `scope=all`. */
  readCount?: number;
  /** The caller posted it, or is HR (`announcement:manage`): may edit, delete and see read tracking. */
  canEdit?: boolean;
}

export interface AnnouncementReads {
  announcementId: string;
  total: number;
  read: number;
  unread: number;
  readPercent: number;
  outsideAudience?: number;
  readers: {
    user: { _id: string; firstName: string; lastName: string; email: string; avatar?: string | null } | string | null;
    readAt: string;
    inAudience?: boolean;
  }[];
}

export const announcementKeys = {
  all: ['announcements'] as const,
  list: (q: object) => ['announcements', 'list', q] as const,
  detail: (id: string) => ['announcements', 'detail', id] as const,
  reads: (id: string) => ['announcements', 'reads', id] as const,
  highlights: ['announcements', 'highlights'] as const,
};

export interface AnnouncementHighlight extends Announcement {
  /** Plain-text excerpt. */
  excerpt: string;
}

export interface AnnouncementHighlights {
  /** Unread, recent: shown once as a pop-up. */
  popup: AnnouncementHighlight[];
  /** Kept at the top of every page: pinned (until expiry) and the last 7 days. */
  bar: AnnouncementHighlight[];
  unreadTotal: number;
}

/** Polls every 15 s so a new announcement pops up almost immediately for people already in the app. */
export const useAnnouncementHighlights = () =>
  useQuery({
    queryKey: announcementKeys.highlights,
    queryFn: () => get<AnnouncementHighlights>('/announcements/highlights'),
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
    staleTime: 10_000,
  });

export const useAnnouncements = (query: object) =>
  useQuery({
    queryKey: announcementKeys.list(query),
    queryFn: () => getPaged<Announcement>('/announcements', query),
    placeholderData: keepPreviousData,
  });

export const useAnnouncement = (id: string | undefined) =>
  useQuery({ queryKey: announcementKeys.detail(id ?? ''), queryFn: () => get<Announcement>(`/announcements/${id}`), enabled: !!id });

export const useAnnouncementReads = (id: string | null) =>
  useQuery({ queryKey: announcementKeys.reads(id ?? ''), queryFn: () => get<AnnouncementReads>(`/announcements/${id}/reads`), enabled: !!id });

const useInvalidate = () => {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: announcementKeys.all }),
      // Dashboards embed the latest announcements.
      qc.invalidateQueries({ queryKey: ['dashboard'] }),
    ]);
};

export const useSaveAnnouncement = (id?: string) => {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (input: AnnouncementInput | AnnouncementUpdateInput) =>
      id ? patch<Announcement>(`/announcements/${id}`, input) : post<Announcement>('/announcements', input),
    meta: { silent: true },
    onSuccess: invalidate,
  });
};

export const useDeleteAnnouncement = () => {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: (id: string) => del(`/announcements/${id}`), onSuccess: invalidate });
};

export const useMarkAnnouncementRead = () => {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => post<{ read: boolean }>(`/announcements/${id}/read`),
    // Read tracking is best-effort and should never surface an error toast.
    meta: { silent: true },
    onSuccess: invalidate,
  });
};

export const uploadAnnouncementAttachment = async (file: File) =>
  (await upload<AnnouncementAttachment>('/files', file, { context: 'ANNOUNCEMENT' })).data;

/** Plain-text excerpt of server-sanitized HTML (DOMParser never executes scripts). */
export const htmlExcerpt = (html: string, max = 220) => {
  const text = (new DOMParser().parseFromString(html, 'text/html').body.textContent ?? '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
};

export const attachmentName = (a: AnnouncementAttachment) => a.title || a.originalName || 'Attachment';
