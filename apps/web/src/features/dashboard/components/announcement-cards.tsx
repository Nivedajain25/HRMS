import type { CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays, Cake, ClipboardList, GraduationCap, Megaphone, PartyPopper, Pin, Siren, Sparkles, type LucideIcon } from 'lucide-react';
import { cn, timeAgo } from '@/lib/utils';
import type { DashboardAnnouncement, EmployeeDashboard } from '../api';
import { ViewAllLink, Widget, WidgetEmpty } from './widget';

/** A fitting icon from the announcement's words. */
const iconFor = (a: DashboardAnnouncement): LucideIcon => {
  const t = `${a.title} ${a.excerpt}`.toLowerCase();
  if (a.priority === 'URGENT') return Siren;
  if (/birthday|b'day/.test(t)) return Cake;
  if (/congrat|anniversar|welcome|promot|award|achiev|milestone|farewell/.test(t)) return PartyPopper;
  if (/holiday|closed|diwali|festival|christmas|thanksgiving|eid|pongal|new year/.test(t)) return CalendarDays;
  if (/policy|update|guideline|rule|process/.test(t)) return ClipboardList;
  if (/event|party|celebrat|lunch|outing|team/.test(t)) return Sparkles;
  if (/training|workshop|session|webinar/.test(t)) return GraduationCap;
  return Megaphone;
};

/** Soft tile behind the icon, cycled per strip (urgent ones always red). */
const TILES = [
  'bg-orange-100 text-orange-600 dark:bg-orange-500/20 dark:text-orange-300',
  'bg-indigo-100 text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-300',
  'bg-teal-100 text-teal-600 dark:bg-teal-500/20 dark:text-teal-300',
  'bg-pink-100 text-pink-600 dark:bg-pink-500/20 dark:text-pink-300',
  'bg-amber-100 text-amber-600 dark:bg-amber-500/20 dark:text-amber-300',
];

/** One announcement as a slim notification strip (like a taskbar notification). */
const AnnouncementStrip = ({ a, index }: { a: DashboardAnnouncement; index: number }) => {
  const urgent = a.priority === 'URGENT';
  const Icon = iconFor(a);
  return (
    <li className="motion-safe:animate-pop-in" style={{ animationDelay: `${index * 70}ms` } as CSSProperties}>
      <Link
        to={`/announcements/${a._id}`}
        className={cn(
          'flex items-center gap-3 rounded-xl border border-l-4 bg-surface px-3 py-2.5 transition-colors hover:bg-surface-2',
          'focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none',
          urgent ? 'border-rose-200 border-l-rose-500 dark:border-rose-500/30' : a.read ? 'border-line border-l-line-strong' : 'border-line border-l-brand-500',
        )}
      >
        <span
          className={cn(
            'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
            urgent ? 'bg-rose-100 text-rose-600 dark:bg-rose-500/20 dark:text-rose-300' : TILES[index % TILES.length],
          )}
          aria-hidden
        >
          <Icon className="h-[18px] w-[18px]" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-sm font-semibold text-fg">{a.title}</span>
            {a.pinned && <Pin className="h-3 w-3 shrink-0 text-muted" aria-label="Pinned" />}
          </span>
          <span className="block truncate text-xs text-muted">{a.excerpt}</span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1">
          <span className="text-[11px] whitespace-nowrap text-subtle">{timeAgo(a.publishAt)}</span>
          {!a.read && <span className="h-2 w-2 rounded-full bg-brand-500" aria-label="New" />}
        </span>
      </Link>
    </li>
  );
};

/** "My day": the latest announcements as slim notification strips. */
export const AnnouncementCards = ({ data, className, titleBox }: { data: EmployeeDashboard; className?: string; titleBox?: string }) => (
  <Widget
    title="Latest announcements"
    titleBox={titleBox}
    icon={<Megaphone className="h-4 w-4" />}
    accent="amber"
    className={className}
    action={<ViewAllLink to="/announcements" />}
    empty={!data.announcements.length}
    emptyState={
      <WidgetEmpty icon={<Megaphone className="h-4 w-4" />} title="No announcements" description="Company news will appear here." />
    }
  >
    {/* Stacked notification strips, newest first. */}
    <ul className="flex flex-col gap-2 px-4 py-3">
      {data.announcements.slice(0, 4).map((a, i) => (
        <AnnouncementStrip key={a._id} a={a} index={i} />
      ))}
    </ul>
  </Widget>
);
