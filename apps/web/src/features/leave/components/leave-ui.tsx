import type { AuthUser } from '@stencil/types';
import { cn, formatDate, toDateKey, apiDateKey } from '@/lib/utils';
import { DEFAULT_TYPE_COLOR, PENDING_STATUSES, type LeaveRequest, type LeaveTypeRef } from '../api';

/** Colored dot + leave type name. */
export const LeaveTypeLabel = ({ type, className, showCode }: { type: LeaveTypeRef | null | undefined; className?: string; showCode?: boolean }) => (
  <span className={cn('inline-flex min-w-0 items-center gap-2', className)}>
    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: type?.color ?? DEFAULT_TYPE_COLOR }} aria-hidden />
    <span className="truncate text-fg">{type?.name ?? 'Leave'}</span>
    {showCode && type?.code && <span className="font-mono text-[11px] text-muted">{type.code}</span>}
  </span>
);

/** Formats a `YYYY-MM-DD` key as a UTC calendar date (date-only ISO strings parse as local time). */
export const formatKey = (key: string, pattern?: string) => formatDate(`${key}T00:00:00Z`, pattern);

export const sessionLabel = (s?: string | null) => (s === 'SECOND_HALF' ? 'Second half' : 'First half');

/** "12 Sep 2026" or "12 Sep – 14 Sep 2026" (+ half-day session). */
export const leaveRange = (l: Pick<LeaveRequest, 'startDate' | 'endDate' | 'halfDay' | 'halfDaySession'>) => {
  const s = apiDateKey(l.startDate);
  const e = apiDateKey(l.endDate);
  if (s === e) return `${formatDate(l.startDate)}${l.halfDay ? ` · ${sessionLabel(l.halfDaySession)}` : ''}`;
  const sameYear = s.slice(0, 4) === e.slice(0, 4);
  return `${formatDate(l.startDate, sameYear ? 'dd MMM' : 'dd MMM yyyy')} – ${formatDate(l.endDate)}`;
};

/* ----------------------------- Permissions ----------------------------- */

export const isLeaveOwner = (user: AuthUser | null, l: LeaveRequest) =>
  !!user && ((!!user.employeeId && l.employeeId?._id === user.employeeId) || l.requestedBy === user._id);

const has = (user: AuthUser | null, p: string) => !!user?.permissions.includes(p);

/** Mirrors the API cancellation rules (the API remains the authority). */
export const canCancelLeave = (user: AuthUser | null, l: LeaveRequest) => {
  const owner = isLeaveOwner(user, l);
  const hr = has(user, 'leave:update');
  if (l.status === 'DRAFT') return owner;
  if (PENDING_STATUSES.includes(l.status)) return owner || hr;
  if (l.status === 'APPROVED') return hr || (owner && apiDateKey(l.startDate) > toDateKey(new Date()));
  return false;
};

/** Whether to offer approve/reject; the API checks the exact approval step. */
export const canDecideLeave = (user: AuthUser | null, l: LeaveRequest) => {
  if (!PENDING_STATUSES.includes(l.status) || !has(user, 'leave:approve')) return false;
  if (user?.employeeId && l.employeeId?._id === user.employeeId) return false;
  if (l.currentApproverType === 'HR') return has(user, 'leave:read');
  if (l.currentApproverType === 'MANAGER') return has(user, 'leave:read') || !!user?.isManager || has(user, 'team:view');
  return false;
};

export const canRejectLeave = (user: AuthUser | null, l: LeaveRequest) => canDecideLeave(user, l) && has(user, 'leave:reject');

export const canEditLeave = (user: AuthUser | null, l: LeaveRequest) => l.status === 'DRAFT' && isLeaveOwner(user, l);
