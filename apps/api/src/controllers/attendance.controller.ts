import type { Request } from 'express';
import type {
  AttendanceCreateInput,
  AttendanceUpdateInput,
  PaginationQuery,
  RegularizationInput,
} from '@stencil/shared';
import type { clockInSchema, clockOutSchema, holidaySchema, holidayUpdateSchema, shiftAssignmentSchema, shiftSchema, shiftUpdateSchema } from '@stencil/shared';
import type { z } from 'zod';
import { body, query } from '../middleware/validate';
import * as attendance from '../services/attendance.service';
import * as holidays from '../services/holiday.service';
import * as regularization from '../services/regularization.service';
import * as shifts from '../services/shift.service';
import { handle, handleCreated, handlePaged, idOf } from '../utils/controller';

type Q = PaginationQuery & Record<string, string | undefined>;
const q = (req: Request) => query<Q>(req);

export const attendanceController = {
  today: handle((ctx) => attendance.getToday(ctx)),
  checkIn: handle((ctx, req) => attendance.checkIn(ctx, body<z.output<typeof clockInSchema>>(req)), 'Checked in'),
  checkOut: handle((ctx, req) => attendance.checkOut(ctx, body<z.output<typeof clockOutSchema>>(req) ?? {}), 'Checked out'),
  breakStart: handle((ctx) => attendance.startBreak(ctx), 'Break started'),
  breakEnd: handle((ctx) => attendance.endBreak(ctx), 'Break ended'),
  list: handlePaged((ctx, req) => attendance.listAttendance(ctx, q(req))),
  get: handle((ctx, req) => attendance.getAttendance(ctx, idOf(req))),
  summary: handle((ctx, req) =>
    attendance.attendanceSummary(ctx, query<{ from?: string; to?: string; employeeId?: string; departmentId?: string; scope?: string }>(req)),
  ),
  dashboard: handle((ctx, req) => attendance.attendanceDashboard(ctx, query<{ date?: string; scope?: string }>(req))),
  board: handle((ctx, req) => attendance.attendanceBoard(ctx, query<{ date?: string; scope?: string; departmentId?: string }>(req))),
  create: handleCreated((ctx, req) => attendance.createAttendance(ctx, body<AttendanceCreateInput>(req)), 'Attendance recorded'),
  update: handle((ctx, req) => attendance.updateAttendance(ctx, idOf(req), body<AttendanceUpdateInput>(req)), 'Attendance updated'),
};

export const regularizationController = {
  submit: handleCreated((ctx, req) => regularization.submitRegularization(ctx, body<RegularizationInput>(req)), 'Correction request submitted'),
  list: handlePaged((ctx, req) => regularization.listRegularizations(ctx, q(req))),
  get: handle((ctx, req) => regularization.getRegularization(ctx, idOf(req))),
  approve: handle((ctx, req) => regularization.approveRegularization(ctx, idOf(req), body<{ comment?: string }>(req) ?? {}), 'Correction approved'),
  reject: handle((ctx, req) => regularization.rejectRegularization(ctx, idOf(req), body<{ reason: string }>(req)), 'Correction rejected'),
  cancel: handle((ctx, req) => regularization.cancelRegularization(ctx, idOf(req)), 'Correction cancelled'),
};

export const shiftController = {
  list: handlePaged((ctx, req) => shifts.listShifts(ctx, q(req))),
  all: handle((ctx) => shifts.allShifts(ctx)),
  get: handle((ctx, req) => shifts.getShift(ctx, idOf(req))),
  create: handleCreated((ctx, req) => shifts.createShift(ctx, body<z.output<typeof shiftSchema>>(req)), 'Shift created'),
  update: handle((ctx, req) => shifts.updateShift(ctx, idOf(req), body<z.output<typeof shiftUpdateSchema>>(req)), 'Shift updated'),
  remove: handle((ctx, req) => shifts.removeShift(ctx, idOf(req)), 'Shift deleted'),
  assign: handle((ctx, req) => shifts.assignShift(ctx, body<z.output<typeof shiftAssignmentSchema>>(req)), 'Shift assigned'),
  assignments: handlePaged((ctx, req) => shifts.listAssignments(ctx, q(req))),
  schedule: handle((ctx, req) => shifts.getSchedule(ctx, query<{ from: string; to: string; departmentId?: string }>(req))),
};

export const holidayController = {
  list: handle((ctx, req) => holidays.listHolidays(ctx, query<{ year?: number; locationId?: string; type?: string }>(req))),
  upcoming: handle((ctx, req) => holidays.upcomingHolidays(ctx, query<{ limit?: number }>(req))),
  get: handle((ctx, req) => holidays.getHoliday(ctx, idOf(req))),
  create: handleCreated((ctx, req) => holidays.createHoliday(ctx, body<z.output<typeof holidaySchema>>(req)), 'Holiday created'),
  update: handle((ctx, req) => holidays.updateHoliday(ctx, idOf(req), body<z.output<typeof holidayUpdateSchema>>(req)), 'Holiday updated'),
  remove: handle((ctx, req) => holidays.removeHoliday(ctx, idOf(req)), 'Holiday deleted'),
};
