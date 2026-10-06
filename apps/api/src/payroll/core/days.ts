import { prorationFactor, round2 } from './engine';

/**
 * Pure attendance/leave → pay-days computation for one employee and period.
 *
 * - basisDays: CALENDAR → days in period; WORKING → working days in period.
 * - notEmployedDays: days (per basis) before joining or after exit.
 * - unpaidLeaveDays: APPROVED leave of unpaid types on WORKING days (0.5 for half days).
 * - paidLeaveDays: same for paid types.
 * - absentDays: ABSENT attendance on WORKING days not covered by approved leave.
 * - lopDays = unpaidLeaveDays + absentDays.
 * - paidDays = basisDays − notEmployedDays − lopDays; factor = paidDays / basisDays.
 * - presentDays: PRESENT / LATE / WORK_FROM_HOME = 1, HALF_DAY = 0.5.
 *   (A HALF_DAY attendance is not treated as LOP; mark leave/absence explicitly.)
 */

export type DayKind = 'WORKING' | 'WEEK_OFF' | 'HOLIDAY';

export interface LeaveSpan {
  dates: string[];
  halfDay: boolean;
  paid: boolean;
}

export interface AttendanceDay {
  date: string;
  status: string;
  overtimeMinutes?: number;
}

export interface DaysInput {
  dates: string[];
  kindOf: (dateKey: string) => DayKind;
  employedFrom: string;
  employedTo: string;
  basis: 'CALENDAR' | 'WORKING';
  leaves: LeaveSpan[];
  attendance: AttendanceDay[];
}

export interface DaySummary {
  daysInPeriod: number;
  workingDays: number;
  holidays: number;
  weekOffs: number;
  basisDays: number;
  notEmployedDays: number;
  paidLeaveDays: number;
  unpaidLeaveDays: number;
  absentDays: number;
  presentDays: number;
  lopDays: number;
  paidDays: number;
  overtimeMinutes: number;
  factor: number;
}

const PRESENT = new Set(['PRESENT', 'LATE', 'WORK_FROM_HOME']);

export const computeDays = (input: DaysInput): DaySummary => {
  const employed = (d: string) => d >= input.employedFrom && d <= input.employedTo;
  const period = new Set(input.dates);
  let workingDays = 0;
  let holidays = 0;
  let weekOffs = 0;
  let notEmployed = 0;
  for (const d of input.dates) {
    const kind = input.kindOf(d);
    if (kind === 'WORKING') workingDays++;
    else if (kind === 'HOLIDAY') holidays++;
    else weekOffs++;
    if (!employed(d) && (input.basis === 'CALENDAR' || kind === 'WORKING')) notEmployed++;
  }

  const leaveOn = new Map<string, number>();
  let paidLeave = 0;
  let unpaidLeave = 0;
  for (const l of input.leaves) {
    for (const d of l.dates) {
      if (!period.has(d) || !employed(d) || input.kindOf(d) !== 'WORKING') continue;
      const amount = Math.min(l.halfDay ? 0.5 : 1, 1 - (leaveOn.get(d) ?? 0));
      if (amount <= 0) continue;
      leaveOn.set(d, (leaveOn.get(d) ?? 0) + amount);
      if (l.paid) paidLeave += amount;
      else unpaidLeave += amount;
    }
  }

  let present = 0;
  let absent = 0;
  let overtime = 0;
  for (const a of input.attendance) {
    if (!period.has(a.date) || !employed(a.date)) continue;
    overtime += a.overtimeMinutes ?? 0;
    if (PRESENT.has(a.status)) present += 1;
    else if (a.status === 'HALF_DAY') present += 0.5;
    else if (a.status === 'ABSENT' && input.kindOf(a.date) === 'WORKING') {
      absent += Math.max(0, 1 - (leaveOn.get(a.date) ?? 0));
    }
  }

  const basisDays = input.basis === 'WORKING' ? workingDays : input.dates.length;
  const lop = round2(unpaidLeave + absent);
  const paidDays = round2(Math.max(0, basisDays - notEmployed - lop));
  return {
    daysInPeriod: input.dates.length,
    workingDays,
    holidays,
    weekOffs,
    basisDays,
    notEmployedDays: notEmployed,
    paidLeaveDays: round2(paidLeave),
    unpaidLeaveDays: round2(unpaidLeave),
    absentDays: round2(absent),
    presentDays: round2(present),
    lopDays: lop,
    paidDays,
    overtimeMinutes: overtime,
    factor: prorationFactor(basisDays, lop, notEmployed),
  };
};
