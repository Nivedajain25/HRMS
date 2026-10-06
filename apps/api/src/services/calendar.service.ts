import type { Types } from 'mongoose';
import type { Weekday } from '@stencil/shared';
import { EmployeeModel, HolidayModel, OrganizationModel } from '../models';
import { dateOnly, eachDateKey, toDateKey, weekdayOf } from '../utils/dates';

export type DayKind = 'WORKING' | 'WEEK_OFF' | 'HOLIDAY';

export interface WorkCalendar {
  timezone: string;
  workingDays: Weekday[];
  /** dateKey → holiday name */
  holidays: Map<string, string>;
  kindOf(dateKey: string): DayKind;
  /** Working dates in [from, to] (inclusive). */
  workingDates(from: string, to: string): string[];
}

/**
 * Holidays applicable in a date range: organization-wide ones plus those
 * scoped to the given location. Recurring holidays repeat every year on the
 * same month/day.
 */
export const holidaysInRange = async (
  organizationId: Types.ObjectId,
  from: string,
  to: string,
  locationId?: Types.ObjectId | null,
) => {
  const locationFilter = { $or: [{ locationIds: { $size: 0 } }, ...(locationId ? [{ locationIds: locationId }] : [])] };
  const [fixed, recurring] = await Promise.all([
    HolidayModel.find({ organizationId, deletedAt: null, recurring: false, date: { $gte: dateOnly(from), $lte: dateOnly(to) }, ...locationFilter }).lean(),
    HolidayModel.find({ organizationId, deletedAt: null, recurring: true, ...locationFilter }).lean(),
  ]);
  const map = new Map<string, { name: string; type: string; optional: boolean }>();
  for (const h of fixed) map.set(toDateKey(h.date), { name: h.name, type: h.type, optional: h.type === 'OPTIONAL' });
  const startYear = Number(from.slice(0, 4));
  const endYear = Number(to.slice(0, 4));
  for (const h of recurring) {
    const md = toDateKey(h.date).slice(5);
    for (let y = startYear; y <= endYear; y++) {
      const key = `${y}-${md}`;
      if (key >= from && key <= to && !map.has(key)) map.set(key, { name: h.name, type: h.type, optional: h.type === 'OPTIONAL' });
    }
  }
  return map;
};

/**
 * Builds the working calendar for an employee (or the organization when no
 * employee is given) for a date range. Optional holidays are not treated as
 * days off (they must be availed as leave).
 */
export const buildWorkCalendar = async (
  organizationId: Types.ObjectId,
  from: string,
  to: string,
  employeeId?: Types.ObjectId | null,
): Promise<WorkCalendar> => {
  const [org, employee] = await Promise.all([
    OrganizationModel.findById(organizationId).select('timezone workingDays').lean(),
    employeeId ? EmployeeModel.findOne({ _id: employeeId, organizationId }).select('locationId').lean() : null,
  ]);
  const all = await holidaysInRange(organizationId, from, to, employee?.locationId ?? null);
  const holidays = new Map<string, string>();
  for (const [k, v] of all) if (!v.optional) holidays.set(k, v.name);
  const workingDays = (org?.workingDays ?? ['MON', 'TUE', 'WED', 'THU', 'FRI']) as Weekday[];

  const kindOf = (dateKey: string): DayKind => {
    if (holidays.has(dateKey)) return 'HOLIDAY';
    return workingDays.includes(weekdayOf(dateKey)) ? 'WORKING' : 'WEEK_OFF';
  };
  return {
    timezone: org?.timezone ?? 'UTC',
    workingDays,
    holidays,
    kindOf,
    workingDates: (a, b) => eachDateKey(a, b).filter((d) => kindOf(d) === 'WORKING'),
  };
};
