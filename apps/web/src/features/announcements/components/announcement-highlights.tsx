import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Megaphone, Paperclip, Pin, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Avatar, Badge } from '@/components/ui/display';
import { Modal } from '@/components/ui/overlay';
import { cn, fullName, timeAgo } from '@/lib/utils';
import { useRegisterPopup } from '@/store/popups';
import { useAnnouncementHighlights, useMarkAnnouncementRead, type AnnouncementHighlight } from '../api';

/* ------------------------------ Storage ------------------------------ */

/** "Remind me later": hidden from the pop-up for this browser session only. */
const SNOOZE_KEY = 'announcements:snoozed';
/** Non-pinned announcements the viewer closed in the top bar (per browser). */
const HIDDEN_KEY = 'announcements:bar-hidden';

const readIds = (storage: () => Storage, key: string): string[] => {
  try {
    const v = JSON.parse(storage().getItem(key) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
};
const writeIds = (storage: () => Storage, key: string, ids: string[]) => {
  try {
    storage().setItem(key, JSON.stringify(ids.slice(-100)));
  } catch {
    /* storage unavailable (private mode): the choice lasts until reload */
  }
};

const PRIORITY_TONE = { URGENT: 'red', HIGH: 'amber' } as const;

const PriorityBadge = ({ priority }: { priority: AnnouncementHighlight['priority'] }) =>
  priority === 'URGENT' || priority === 'HIGH' ? (
    <Badge tone={PRIORITY_TONE[priority]} dot>
      {priority === 'URGENT' ? 'Urgent' : 'Important'}
    </Badge>
  ) : null;

/* ------------------------------- Pop-up ------------------------------ */

/**
 * Shows each new (unread) announcement once as a pop-up when the viewer opens the app, or within a minute
 * of it being published while they are in the app. "Got it" marks it read; closing snoozes it for this session.
 */
export const AnnouncementPopup = () => {
  const highlights = useAnnouncementHighlights();
  const markRead = useMarkAnnouncementRead();
  const navigate = useNavigate();
  const [snoozed, setSnoozed] = useState<string[]>(() => readIds(() => sessionStorage, SNOOZE_KEY));
  // Advance immediately after "Got it", without waiting for the refetch.
  const [handled, setHandled] = useState<string[]>([]);

  const queue = useMemo(
    () => (highlights.data?.popup ?? []).filter((a) => !snoozed.includes(a._id) && !handled.includes(a._id)),
    [highlights.data, snoozed, handled],
  );
  const current = queue[0];
  const total = queue.length;
  // Other pop-ups (e.g. new tasks) wait until this one is dealt with.
  useRegisterPopup('announcement', !!current);

  const snooze = () => {
    if (!current) return;
    const next = [...snoozed, current._id];
    setSnoozed(next);
    writeIds(() => sessionStorage, SNOOZE_KEY, next);
  };
  const acknowledge = () => {
    if (!current) return;
    setHandled((h) => [...h, current._id]);
    markRead.mutate(current._id);
  };
  const openFull = () => {
    if (!current) return;
    acknowledge();
    navigate(`/announcements/${current._id}`);
  };

  if (!current) return null;
  const author = current.createdBy ? fullName(current.createdBy) : null;

  return (
    <Modal
      open
      onClose={snooze}
      size="lg"
      title={
        <span className="flex items-center gap-2">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300">
            <Megaphone className="h-4 w-4" aria-hidden />
          </span>
          <span className="min-w-0">{current.title}</span>
        </span>
      }
      description={
        <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
          <span>New announcement</span>
          <PriorityBadge priority={current.priority} />
          {current.pinned && (
            <Badge tone="brand">
              <Pin className="h-3 w-3" aria-hidden /> Pinned
            </Badge>
          )}
        </span>
      }
      footer={
        <>
          {total > 1 && <span className="mr-auto self-center text-xs text-muted">1 of {total} new</span>}
          <Button variant="ghost" onClick={snooze}>
            Remind me later
          </Button>
          <Button variant="outline" onClick={openFull}>
            Open full announcement
          </Button>
          <Button onClick={acknowledge}>{total > 1 ? 'Got it, next' : 'Got it'}</Button>
        </>
      }
    >
      {author && (
        <div className="mb-4 flex items-center gap-2 text-sm text-muted">
          <Avatar name={author} src={current.createdBy?.avatar} size="xs" />
          <span>
            <span className="font-medium text-fg-2">{author}</span> · {timeAgo(current.publishAt)}
          </span>
        </div>
      )}
      {/* `content` is sanitized server-side with an allowlist before it is stored (see announcement-detail-page). */}
      <div className="prose-content text-[15px] leading-relaxed break-words text-fg-2" dangerouslySetInnerHTML={{ __html: current.content }} />
      {current.attachmentIds.length > 0 && (
        <button type="button" onClick={openFull} className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-brand-600 hover:underline dark:text-brand-400">
          <Paperclip className="h-4 w-4" aria-hidden />
          {current.attachmentIds.length} attachment{current.attachmentIds.length > 1 ? 's' : ''} — open the full announcement
        </button>
      )}
    </Modal>
  );
};

/* ---------------------------- Pinned bar ----------------------------- */

const ROTATE_MS = 8000;

/**
 * Slim bar under the header on every page, like a pinned message: announcements pinned by HR (until they
 * expire) and those from the last 7 days. Several rotate; non-pinned ones can be closed by the viewer.
 */
export const AnnouncementBar = () => {
  const highlights = useAnnouncementHighlights();
  const [hidden, setHidden] = useState<string[]>(() => readIds(() => localStorage, HIDDEN_KEY));
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  const items = useMemo(() => (highlights.data?.bar ?? []).filter((a) => a.pinned || !hidden.includes(a._id)), [highlights.data, hidden]);
  const count = items.length;
  const current = items[Math.min(index, Math.max(0, count - 1))];

  useEffect(() => {
    if (count < 2 || paused) return;
    const id = window.setInterval(() => setIndex((i) => (i + 1) % count), ROTATE_MS);
    return () => window.clearInterval(id);
  }, [count, paused]);

  if (!current) return null;
  const go = (step: number) => setIndex((i) => (((i + step) % count) + count) % count);
  const hide = () => {
    const next = [...hidden, current._id];
    setHidden(next);
    writeIds(() => localStorage, HIDDEN_KEY, next);
  };
  const urgent = current.priority === 'URGENT';
  const Icon = current.pinned ? Pin : Megaphone;

  return (
    <div
      role="region"
      aria-label="Pinned announcements"
      aria-live="polite"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className={cn(
        'flex shrink-0 items-center gap-2 border-b px-4 py-2 text-[15px] sm:px-6',
        urgent
          ? 'border-red-200 bg-red-50 text-red-900 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200'
          : 'border-brand-100 bg-brand-50 text-black dark:border-brand-500/20 dark:bg-brand-500/10 dark:text-white',
      )}
    >
      <Icon className={cn('h-4 w-4 shrink-0', urgent ? 'text-red-600 dark:text-red-300' : 'text-brand-600 dark:text-brand-300')} aria-label={current.pinned ? 'Pinned' : 'Announcement'} />
      <Link to={`/announcements/${current._id}`} className="group flex min-w-0 flex-1 items-center gap-2" title={current.title}>
        {!current.read && <span className="h-2 w-2 shrink-0 rounded-full bg-current" aria-label="Unread" />}
        <span className="shrink-0 text-base font-semibold group-hover:underline">{current.title}</span>
        <span className="hidden min-w-0 truncate sm:inline">— {current.excerpt}</span>
      </Link>
      <span className="hidden shrink-0 md:inline">{timeAgo(current.publishAt)}</span>
      {count > 1 && (
        <span className="flex shrink-0 items-center">
          <button type="button" onClick={() => go(-1)} className="rounded p-1 hover:bg-black/5 dark:hover:bg-white/10" aria-label="Previous announcement">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="w-10 text-center tabular-nums">
            {Math.min(index, count - 1) + 1}/{count}
          </span>
          <button type="button" onClick={() => go(1)} className="rounded p-1 hover:bg-black/5 dark:hover:bg-white/10" aria-label="Next announcement">
            <ChevronRight className="h-4 w-4" />
          </button>
        </span>
      )}
      {!current.pinned && (
        <button type="button" onClick={hide} className="shrink-0 rounded p-1 hover:bg-black/5 dark:hover:bg-white/10" aria-label={`Hide “${current.title}” from the top bar`} title="Hide from the top bar">
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
};
