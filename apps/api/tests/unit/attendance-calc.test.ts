import { describe, expect, it } from 'vitest';
import {
  closeOpenBreaks,
  computeMetrics,
  fallbackShift,
  haversineMeters,
  liveState,
  officeProximity,
  overtimeThresholdMinutes,
  shiftWindow,
  spansMidnight,
  sumBreakMinutes,
  withinGeofence,
  type MetricsInput,
  type ShiftRule,
} from '../../src/services/attendance-calc';

const TZ = 'UTC';
const DAY = '2026-03-10';
const at = (time: string, day = DAY) => new Date(`${day}T${time}:00.000Z`);

const general: ShiftRule = {
  startTime: '09:00',
  endTime: '18:00',
  gracePeriodMinutes: 15,
  breakDurationMinutes: 60,
  workingHours: 8,
  halfDayHours: 4,
  flexible: false,
};

const input = (over: Partial<MetricsInput> = {}): MetricsInput => {
  const shift = over.shift ?? general;
  return {
    checkIn: at('09:00'),
    checkOut: at('18:00'),
    breaks: [],
    workMode: 'OFFICE',
    shift,
    window: shiftWindow(DAY, shift, TZ),
    overtimeAfterHours: 9,
    ...over,
  };
};

describe('attendance-calc: shift windows', () => {
  it('builds a same-day window', () => {
    const w = shiftWindow(DAY, general, TZ);
    expect(w.start.toISOString()).toBe('2026-03-10T09:00:00.000Z');
    expect(w.end.toISOString()).toBe('2026-03-10T18:00:00.000Z');
  });

  it('night shifts end on the next day', () => {
    const night = { ...general, startTime: '22:00', endTime: '06:00' };
    expect(spansMidnight(night)).toBe(true);
    const w = shiftWindow(DAY, night, TZ);
    expect(w.start.toISOString()).toBe('2026-03-10T22:00:00.000Z');
    expect(w.end.toISOString()).toBe('2026-03-11T06:00:00.000Z');
  });

  it('respects the organization timezone', () => {
    const w = shiftWindow(DAY, general, 'Asia/Kolkata');
    expect(w.start.toISOString()).toBe('2026-03-10T03:30:00.000Z');
    expect(w.end.toISOString()).toBe('2026-03-10T12:30:00.000Z');
  });
});

describe('attendance-calc: lateness and grace', () => {
  it('within grace is not late', () => {
    const m = computeMetrics(input({ checkIn: at('09:15') }));
    expect(m.isLate).toBe(false);
    expect(m.lateMinutes).toBe(0);
    expect(m.status).toBe('PRESENT');
  });

  it('after grace is late by the minutes beyond grace', () => {
    const m = computeMetrics(input({ checkIn: at('09:40'), checkOut: at('18:30') }));
    expect(m.isLate).toBe(true);
    expect(m.lateMinutes).toBe(25);
    expect(m.status).toBe('LATE');
  });

  it('flexible shifts are never late or early', () => {
    const flex = { ...general, flexible: true };
    const m = computeMetrics(input({ shift: flex, window: shiftWindow(DAY, flex, TZ), checkIn: at('11:00'), checkOut: at('17:00') }));
    expect(m.lateMinutes).toBe(0);
    expect(m.earlyDepartureMinutes).toBe(0);
    expect(m.status).toBe('PRESENT');
  });

  it('flags early departure', () => {
    const m = computeMetrics(input({ checkOut: at('17:30') }));
    expect(m.isEarlyDeparture).toBe(true);
    expect(m.earlyDepartureMinutes).toBe(30);
  });

  it('is late while still checked in (status before check-out)', () => {
    const m = computeMetrics(input({ checkIn: at('10:00'), checkOut: null }));
    expect(m.status).toBe('LATE');
    expect(m.workingMinutes).toBe(0);
    expect(m.overtimeMinutes).toBe(0);
  });
});

describe('attendance-calc: breaks and working time', () => {
  it('subtracts closed breaks from working time', () => {
    const m = computeMetrics(input({ breaks: [{ start: at('13:00'), end: at('13:45') }] }));
    expect(m.breakMinutes).toBe(45);
    expect(m.workingMinutes).toBe(9 * 60 - 45);
  });

  it('auto-closes an open break at check-out', () => {
    const breaks = [{ start: at('17:30'), end: null }];
    expect(closeOpenBreaks(breaks, at('18:00'))[0]!.end!.toISOString()).toBe(at('18:00').toISOString());
    const m = computeMetrics(input({ breaks }));
    expect(m.breakMinutes).toBe(30);
    expect(m.workingMinutes).toBe(9 * 60 - 30);
  });

  it('clips breaks to the check-in/check-out window', () => {
    expect(sumBreakMinutes([{ start: at('08:30'), end: at('09:30') }], at('09:00'), at('18:00'))).toBe(30);
  });

  it('computes night shift hours across midnight', () => {
    const night = { ...general, startTime: '22:00', endTime: '06:00' };
    const m = computeMetrics(
      input({
        shift: night,
        window: shiftWindow(DAY, night, TZ),
        checkIn: at('22:05'),
        checkOut: at('06:00', '2026-03-11'),
        breaks: [{ start: at('02:00', '2026-03-11'), end: at('02:30', '2026-03-11') }],
      }),
    );
    expect(m.workingMinutes).toBe(475 - 30);
    expect(m.isLate).toBe(false);
    expect(m.isEarlyDeparture).toBe(false);
  });
});

describe('attendance-calc: half day, WFH and overtime', () => {
  it('marks half day when worked time is below half-day hours', () => {
    const m = computeMetrics(input({ checkIn: at('09:00'), checkOut: at('12:00') }));
    expect(m.workingMinutes).toBe(180);
    expect(m.status).toBe('HALF_DAY');
  });

  it('falls back to the org half-day threshold when the shift has none', () => {
    const shift = { ...general, halfDayHours: 0 };
    const m = computeMetrics(input({ shift, checkOut: at('13:00'), halfDayThresholdHours: 5 }));
    expect(m.status).toBe('HALF_DAY');
  });

  it('remote work is WORK_FROM_HOME regardless of hours', () => {
    const m = computeMetrics(input({ workMode: 'REMOTE', checkIn: at('10:00'), checkOut: at('12:00') }));
    expect(m.status).toBe('WORK_FROM_HOME');
    expect(m.isLate).toBe(true);
  });

  it('counts overtime beyond the larger of shift hours and org threshold', () => {
    expect(overtimeThresholdMinutes(8, 9)).toBe(540);
    expect(overtimeThresholdMinutes(10, 9)).toBe(600);
    // 9h worked: no overtime (threshold 9h).
    expect(computeMetrics(input()).overtimeMinutes).toBe(0);
    // 10h worked: 60 minutes overtime.
    expect(computeMetrics(input({ checkOut: at('19:00') })).overtimeMinutes).toBe(60);
    // A 10h shift with 9h org threshold: overtime starts after 10h.
    const long = { ...general, workingHours: 10, endTime: '20:00' };
    expect(computeMetrics(input({ shift: long, window: shiftWindow(DAY, long, TZ), checkOut: at('20:00') })).overtimeMinutes).toBe(60);
  });
});

describe('attendance-calc: helpers', () => {
  it('builds a fallback shift from settings', () => {
    const s = fallbackShift({ defaultShiftStart: '10:00', defaultShiftEnd: '19:00', halfDayThresholdHours: 4 });
    expect(s.workingHours).toBe(8);
    expect(s.nightShift).toBe(false);
    expect(fallbackShift({ defaultShiftStart: '22:00', defaultShiftEnd: '07:00' }).nightShift).toBe(true);
  });

  it('computes haversine distance and geofence membership', () => {
    // ~1.11 km per 0.01 degree latitude.
    const d = haversineMeters(12.97, 77.59, 12.98, 77.59);
    expect(d).toBeGreaterThan(1100);
    expect(d).toBeLessThan(1120);
    expect(withinGeofence({ latitude: 12.9701, longitude: 77.59 }, { latitude: 12.97, longitude: 77.59, radiusMeters: 50 })).toBe(true);
    expect(withinGeofence({ latitude: 12.98, longitude: 77.59 }, { latitude: 12.97, longitude: 77.59, radiusMeters: 500 })).toBe(false);
  });

  it('reports office proximity with a capped GPS-accuracy allowance', () => {
    const office = { latitude: 12.97, longitude: 77.59, geofenceRadiusMeters: 150 };
    // ~111 m north.
    expect(officeProximity({ latitude: 12.971, longitude: 77.59 }, office)).toEqual({ distanceMeters: 111, withinOffice: true });
    // ~222 m: outside, unless the fix is poor enough (allowance 80 m).
    expect(officeProximity({ latitude: 12.972, longitude: 77.59 }, office)!.withinOffice).toBe(false);
    expect(officeProximity({ latitude: 12.972, longitude: 77.59, accuracy: 80 }, office)!.withinOffice).toBe(true);
    // The allowance is capped at 100 m: a ±5 km fix 1.1 km away is still outside.
    expect(officeProximity({ latitude: 12.98, longitude: 77.59, accuracy: 5000 }, office)!.withinOffice).toBe(false);
    // No radius: distance only. No coordinates: nothing.
    expect(officeProximity({ latitude: 12.971, longitude: 77.59 }, { ...office, geofenceRadiusMeters: 0 })).toEqual({ distanceMeters: 111, withinOffice: null });
    expect(officeProximity({ latitude: 12.971, longitude: 77.59 }, { latitude: null, longitude: null })).toBeNull();
  });

  it('reports live state', () => {
    expect(liveState(null)).toBe('NOT_CHECKED_IN');
    expect(liveState({ checkIn: at('09:00'), checkOut: null, breaks: [] })).toBe('CHECKED_IN');
    expect(liveState({ checkIn: at('09:00'), checkOut: null, breaks: [{ start: at('12:00'), end: null }] })).toBe('ON_BREAK');
    expect(liveState({ checkIn: at('09:00'), checkOut: at('18:00'), breaks: [] })).toBe('CHECKED_OUT');
  });
});
