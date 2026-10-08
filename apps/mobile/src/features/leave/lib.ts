import type { AuthUser } from '@stencil/types';
import { hasPermission, LEAVE_WORKFLOW, type LeaveStatus, type Permission } from '@stencil/shared';
import { Baby, Briefcase, CalendarDays, Coffee, House, Plane, Repeat, Thermometer, TreePalm, Wallet, type LucideIcon } from 'lucide-react-native';
import { formatDate } from '@/lib/time';
import type { CalendarLeave, LeaveAttachment, LeaveRequest, LeaveType, LeaveTypeRef } from './api';

/* Display helpers and permission rules ported from the web `features/leave` (the API stays the authority). */

export const DEFAULT_TYPE_COLOR = '#64748b';

export const PENDING_STATUSES: readonly LeaveStatus[] = ['SUBMITTED', 'PENDING_APPROVAL'];
export const isPendingStatus = (s: string) => (PENDING_STATUSES as readonly string[]).includes(s);

export const typeOf = (l: { leaveTypeId?: LeaveTypeRef | string | null }): LeaveTypeRef | null =>
  l.leaveTypeId && typeof l.leaveTypeId === 'object' ? l.leaveTypeId : null;

export const attachmentOf = (l: LeaveRequest): LeaveAttachment | null =>
  !l.attachmentId ? null : typeof l.attachmentId === 'object' ? l.attachmentId : { _id: l.attachmentId };

export const typeColor = (t: { color?: string } | null | undefined) => (t?.color && /^#[0-9a-f]{6}$/i.test(t.color) ? t.color : DEFAULT_TYPE_COLOR);

/** An icon for a leave type: by its code first, then by words in its name; a calendar otherwise. */
export const typeIcon = (t: { code?: string; name?: string; isWorkFromHome?: boolean; paid?: boolean } | null | undefined): LucideIcon => {
  if (!t) return CalendarDays;
  const byCode: Record<string, LucideIcon> = {
    CL: Coffee,
    SL: Thermometer,
    EL: TreePalm,
    PL: Plane,
    LOP: Wallet,
    ML: Baby,
    PTL: Baby,
    CO: Repeat,
    WFH: House,
  };
  const code = (t.code ?? '').toUpperCase();
  if (byCode[code]) return byCode[code];
  const name = (t.name ?? '').toLowerCase();
  if (t.isWorkFromHome || /work\s*from\s*home|wfh|remote/.test(name)) return House;
  if (/sick|medical/.test(name)) return Thermometer;
  if (/casual/.test(name)) return Coffee;
  if (/earned|annual/.test(name)) return TreePalm;
  if (/privilege/.test(name)) return Plane;
  if (/matern|patern/.test(name)) return Baby;
  if (/comp/.test(name)) return Repeat;
  if (t.paid === false || /unpaid|loss of pay|lop/.test(name)) return Wallet;
  if (/paid/.test(name)) return Briefcase;
  return CalendarDays;
};

/** `1.5` / `2` (no trailing zeros). */
export const formatNum = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100));

export const formatDays = (n: number) => `${formatNum(n)} ${n === 1 ? 'day' : 'days'}`;

export const sessionLabel = (s?: string | null) => (s === 'SECOND_HALF' ? 'Second half' : 'First half');

export const dateKeyOf = (value: string | null | undefined) => (value ? value.slice(0, 10) : '');

/** "12 Sep 2026" or "12 Sep – 14 Sep 2026" (+ half-day session). */
export const leaveRange = (l: Pick<LeaveRequest, 'startDate' | 'endDate' | 'halfDay' | 'halfDaySession'>) => {
  const s = dateKeyOf(l.startDate);
  const e = dateKeyOf(l.endDate);
  if (s === e) return `${formatDate(l.startDate)}${l.halfDay ? ` · ${sessionLabel(l.halfDaySession)}` : ''}`;
  const sameYear = s.slice(0, 4) === e.slice(0, 4);
  return `${formatDate(l.startDate, sameYear ? 'dd MMM' : 'dd MMM yyyy')} – ${formatDate(l.endDate)}`;
};

export const isCalendarPending = (l: CalendarLeave) => isPendingStatus(l.status);

/** Short policy notes for a leave type (same wording as the web apply drawer). */
export const policyNotes = (t: LeaveType) => {
  const notes: string[] = [];
  const plural = (n: number) => (n === 1 ? '' : 's');
  if (!t.paid) notes.push('Unpaid — not limited by balance');
  if (t.minNoticeDays > 0) notes.push(`Apply ${t.minNoticeDays} day${plural(t.minNoticeDays)} in advance`);
  if (t.maxConsecutiveDays > 0) notes.push(`Max ${t.maxConsecutiveDays} consecutive day${plural(t.maxConsecutiveDays)}`);
  if (t.documentRequired)
    notes.push(
      t.documentRequiredAfterDays > 0
        ? `Document needed beyond ${t.documentRequiredAfterDays} day${plural(t.documentRequiredAfterDays)}`
        : 'Supporting document required',
    );
  if (!t.halfDayAllowed) notes.push('Full days only');
  return notes;
};

/* ----------------------------- Permissions ----------------------------- */

const has = (user: AuthUser | null, p: Permission) => !!user && hasPermission(user.permissions, p);

export const isLeaveOwner = (user: AuthUser | null, l: LeaveRequest) =>
  !!user && ((!!user.employeeId && l.employeeId?._id === user.employeeId) || l.requestedBy === user._id);

/** Owner can submit their own draft. */
export const canSubmitLeave = (user: AuthUser | null, l: LeaveRequest) =>
  l.status === 'DRAFT' && isLeaveOwner(user, l) && LEAVE_WORKFLOW.can(l.status, 'SUBMITTED');

export const canEditLeave = (user: AuthUser | null, l: LeaveRequest) => l.status === 'DRAFT' && isLeaveOwner(user, l);

/** Mirrors the API cancellation rules: owners cancel drafts, pending and not-yet-started approved leave; HR any pending/approved. */
export const canCancelLeave = (user: AuthUser | null, l: LeaveRequest, todayKey: string) => {
  if (!LEAVE_WORKFLOW.can(l.status, 'CANCELLED')) return false;
  const owner = isLeaveOwner(user, l);
  const hr = has(user, 'leave:update');
  if (l.status === 'DRAFT') return owner;
  if (isPendingStatus(l.status)) return owner || hr;
  if (l.status === 'APPROVED') return hr || (owner && dateKeyOf(l.startDate) > todayKey);
  return false;
};

/** Whether to offer approve/reject; the API checks the exact approval step. */
export const canDecideLeave = (user: AuthUser | null, l: LeaveRequest) => {
  if (!isPendingStatus(l.status) || !has(user, 'leave:approve')) return false;
  if (user?.employeeId && l.employeeId?._id === user.employeeId) return false;
  if (l.currentApproverType === 'HR') return has(user, 'leave:read');
  if (l.currentApproverType === 'MANAGER') return has(user, 'leave:read') || !!user?.isManager || has(user, 'team:view');
  return false;
};

export const canRejectLeave = (user: AuthUser | null, l: LeaveRequest) => canDecideLeave(user, l) && has(user, 'leave:reject');
