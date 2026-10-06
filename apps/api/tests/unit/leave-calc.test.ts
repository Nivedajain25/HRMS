import { describe, expect, it } from 'vitest';
import {
  countLeaveDays,
  dateKeysBetween,
  daysBetween,
  leaveRangesOverlap,
  simpleKindOf,
  spansMultipleYears,
} from '../../src/services/leave-calc';

// Mon-Fri working week. 2025-06-02 is a Monday.
const MON_FRI = [1, 2, 3, 4, 5];

describe('leave-calc: working day count', () => {
  const plain = simpleKindOf(MON_FRI, new Set());

  it('counts a full working week', () => {
    const r = countLeaveDays('2025-06-02', '2025-06-06', false, plain);
    expect(r.days).toBe(5);
    expect(r.workingDates).toHaveLength(5);
    expect(r.weekOffs).toEqual([]);
  });

  it('excludes weekends inside the range', () => {
    // Thu → next Tue: Thu, Fri, (Sat, Sun), Mon, Tue
    const r = countLeaveDays('2025-06-05', '2025-06-10', false, plain);
    expect(r.days).toBe(4);
    expect(r.weekOffs).toEqual(['2025-06-07', '2025-06-08']);
  });

  it('excludes holidays', () => {
    const kind = simpleKindOf(MON_FRI, new Set(['2025-06-04']));
    const r = countLeaveDays('2025-06-02', '2025-06-06', false, kind);
    expect(r.days).toBe(4);
    expect(r.holidays).toEqual(['2025-06-04']);
    expect(r.workingDates).not.toContain('2025-06-04');
  });

  it('holiday on a weekend is reported as holiday, not double-excluded', () => {
    const kind = simpleKindOf(MON_FRI, new Set(['2025-06-07']));
    const r = countLeaveDays('2025-06-06', '2025-06-09', false, kind);
    expect(r.days).toBe(2);
    expect(r.holidays).toEqual(['2025-06-07']);
    expect(r.weekOffs).toEqual(['2025-06-08']);
  });

  it('a range of only weekends/holidays yields zero days', () => {
    expect(countLeaveDays('2025-06-07', '2025-06-08', false, plain).days).toBe(0);
    const kind = simpleKindOf(MON_FRI, new Set(['2025-06-02']));
    expect(countLeaveDays('2025-06-02', '2025-06-02', false, kind).days).toBe(0);
  });

  it('half day counts 0.5 on a working day and 0 on a non-working day', () => {
    expect(countLeaveDays('2025-06-02', '2025-06-02', true, plain).days).toBe(0.5);
    expect(countLeaveDays('2025-06-07', '2025-06-07', true, plain).days).toBe(0);
  });

  it('supports custom work weeks (e.g. Sun-Thu)', () => {
    const sunThu = simpleKindOf([0, 1, 2, 3, 4], new Set());
    // Fri 2025-06-06 .. Sun 2025-06-08 → only Sunday works
    expect(countLeaveDays('2025-06-06', '2025-06-08', false, sunThu).days).toBe(1);
  });

  it('handles month and leap-year boundaries', () => {
    expect(dateKeysBetween('2024-02-27', '2024-03-01')).toEqual(['2024-02-27', '2024-02-28', '2024-02-29', '2024-03-01']);
    // Thu 2024-02-29, Fri 03-01, Sat, Sun, Mon 03-04
    expect(countLeaveDays('2024-02-29', '2024-03-04', false, plain).days).toBe(3);
  });

  it('returns zero for an inverted range', () => {
    expect(countLeaveDays('2025-06-06', '2025-06-02', false, plain).days).toBe(0);
  });
});

describe('leave-calc: helpers', () => {
  it('daysBetween', () => {
    expect(daysBetween('2025-06-01', '2025-06-08')).toBe(7);
    expect(daysBetween('2025-06-08', '2025-06-01')).toBe(-7);
    expect(daysBetween('2024-12-31', '2025-01-01')).toBe(1);
  });

  it('spansMultipleYears', () => {
    expect(spansMultipleYears('2025-12-30', '2026-01-02')).toBe(true);
    expect(spansMultipleYears('2025-01-01', '2025-12-31')).toBe(false);
  });

  it('overlap: disjoint, touching and nested ranges', () => {
    expect(leaveRangesOverlap({ startDate: '2025-06-02', endDate: '2025-06-03' }, { startDate: '2025-06-04', endDate: '2025-06-05' })).toBe(false);
    expect(leaveRangesOverlap({ startDate: '2025-06-02', endDate: '2025-06-04' }, { startDate: '2025-06-04', endDate: '2025-06-05' })).toBe(true);
    expect(leaveRangesOverlap({ startDate: '2025-06-01', endDate: '2025-06-30' }, { startDate: '2025-06-10', endDate: '2025-06-10' })).toBe(true);
  });

  it('overlap: half days in different sessions on the same day may coexist', () => {
    const first = { startDate: '2025-06-02', endDate: '2025-06-02', halfDay: true, halfDaySession: 'FIRST_HALF' };
    const second = { ...first, halfDaySession: 'SECOND_HALF' };
    expect(leaveRangesOverlap(first, second)).toBe(false);
    expect(leaveRangesOverlap(first, { ...first })).toBe(true);
    // A half day never coexists with a full day
    expect(leaveRangesOverlap(first, { startDate: '2025-06-02', endDate: '2025-06-02', halfDay: false })).toBe(true);
  });
});
