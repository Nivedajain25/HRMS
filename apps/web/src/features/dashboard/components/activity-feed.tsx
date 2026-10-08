import type { CSSProperties, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity,
  CalendarCheck,
  CalendarX,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  FilePenLine,
  LogIn,
  LogOut,
  Plane,
  Receipt,
  Target,
  Wallet,
  XCircle,
} from 'lucide-react';
import { Avatar } from '@/components/ui/display';
import { cn, timeAgo } from '@/lib/utils';
import { useActivityFeed, type ActivityType } from '../api';
import { ListSkeleton, Widget, WidgetEmpty } from './widget';

const META: Record<ActivityType, { icon: ReactNode; tone: string }> = {
  CLOCK_IN: { icon: <LogIn className="h-3 w-3" />, tone: 'bg-emerald-500' },
  CLOCK_OUT: { icon: <LogOut className="h-3 w-3" />, tone: 'bg-sky-500' },
  LEAVE_APPLIED: { icon: <Plane className="h-3 w-3" />, tone: 'bg-violet-500' },
  LEAVE_APPROVED: { icon: <CalendarCheck className="h-3 w-3" />, tone: 'bg-emerald-500' },
  LEAVE_REJECTED: { icon: <CalendarX className="h-3 w-3" />, tone: 'bg-rose-500' },
  REGULARIZATION_REQUESTED: { icon: <FilePenLine className="h-3 w-3" />, tone: 'bg-amber-500' },
  REGULARIZATION_APPROVED: { icon: <Clock className="h-3 w-3" />, tone: 'bg-emerald-500' },
  REGULARIZATION_REJECTED: { icon: <XCircle className="h-3 w-3" />, tone: 'bg-rose-500' },
  EXPENSE_SUBMITTED: { icon: <Receipt className="h-3 w-3" />, tone: 'bg-orange-500' },
  EXPENSE_APPROVED: { icon: <CheckCircle2 className="h-3 w-3" />, tone: 'bg-emerald-500' },
  EXPENSE_PAID: { icon: <Wallet className="h-3 w-3" />, tone: 'bg-teal-500' },
  GOAL_PROGRESS: { icon: <Target className="h-3 w-3" />, tone: 'bg-indigo-500' },
  GOAL_COMPLETED: { icon: <CheckCircle2 className="h-3 w-3" />, tone: 'bg-fuchsia-500' },
  TASK_DONE: { icon: <ClipboardCheck className="h-3 w-3" />, tone: 'bg-cyan-500' },
};

const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

/**
 * Recent activity and tasks done. `all` (HR / Head): every employee, with names. `me`: the caller's own ("You …").
 */
export const ActivityFeed = ({
  scope,
  className,
  limit = 12,
  boxed = false,
}: {
  scope: 'all' | 'me';
  className?: string;
  limit?: number;
  /** Employee dashboard style: emoji title in a magenta-pink box, a line under the header, pink border. */
  boxed?: boolean;
}) => {
  const q = useActivityFeed(scope, limit);
  const items = q.data ?? [];
  const title = scope === 'all' ? 'Recent activity' : 'My recent activity';
  return (
    <Widget
      title={title}
      description={scope === 'all' ? 'What everyone has been doing · last 7 days' : 'Your actions and tasks done · last 7 days'}
      icon={<Activity className="h-4 w-4" />}
      accent={boxed ? 'warm' : 'purple'}
      className={cn(boxed && 'bg-[#f8fbff] dark:bg-surface [&>header]:border-b [&>header]:border-line', className)}
      loading={q.isLoading}
      error={q.error}
      onRetry={() => q.refetch()}
      skeleton={<ListSkeleton rows={5} />}
      empty={!items.length}
      emptyState={
        <WidgetEmpty
          icon={<Activity className="h-4 w-4" />}
          title="No activity yet"
          description={scope === 'all' ? 'Check-ins, leave, expenses and completed goals will show up here.' : 'Your check-ins, leave and completed tasks will show up here.'}
        />
      }
    >
      {/* No scroll of its own: the list is capped by `limit`, so it shows in full and the page is the only scrollbar. */}
      <ol className="px-5 pb-4">
        {items.map((a, i) => {
          const m = META[a.type];
          // Decisions read as possessive: "Priya’s Casual Leave was approved" / "Your Casual Leave was approved".
          const passive = / was (approved|rejected)$/.test(a.title);
          const subject = scope === 'me' ? (passive ? 'Your' : 'You') : passive ? `${a.employee.name}’s` : a.employee.name;
          const body = (
            <>
              <span className="relative shrink-0">
                <Avatar name={a.employee.name} src={a.employee.profilePhoto} size="sm" />
                <span className={cn('absolute -right-1 -bottom-1 flex h-4 w-4 items-center justify-center rounded-full text-white ring-2 ring-surface', m.tone)} aria-hidden>
                  {m.icon}
                </span>
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm text-fg">
                  <span className="font-semibold">{subject}</span> {a.title}
                </span>
                {a.detail && <span className="block truncate text-xs text-muted">{a.detail}</span>}
              </span>
              <span className="shrink-0 text-right text-[11px] text-subtle" title={new Date(a.at).toLocaleString()}>
                <span className="block">{time(a.at)}</span>
                <span className="block">{timeAgo(a.at)}</span>
              </span>
            </>
          );
          return (
            <li key={a.id} className="motion-safe:animate-fade-up" style={{ animationDelay: `${Math.min(i, 10) * 40}ms` } as CSSProperties}>
              {a.link ? (
                <Link to={a.link} className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-surface-2">
                  {body}
                </Link>
              ) : (
                <div className="flex items-center gap-3 py-2">{body}</div>
              )}
            </li>
          );
        })}
      </ol>
    </Widget>
  );
};
