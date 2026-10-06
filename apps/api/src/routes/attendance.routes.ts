import {
  attendanceCreateSchema,
  attendanceBoardQuery,
  attendanceDashboardQuery,
  attendanceListQuery,
  attendanceSummaryQuery,
  attendanceUpdateSchema,
  clockInSchema,
  clockOutSchema,
  commentBody,
  holidayListQuery,
  holidaySchema,
  holidayUpcomingQuery,
  holidayUpdateSchema,
  idParam,
  paginationQuery,
  regularizationListQuery,
  regularizationSchema,
  rejectBody,
  shiftAssignmentListQuery,
  shiftAssignmentSchema,
  shiftScheduleQuery,
  shiftSchema,
  shiftUpdateSchema,
} from '@stencil/shared';
import {
  attendanceController as att,
  holidayController as hol,
  regularizationController as reg,
  shiftController as shift,
} from '../controllers/attendance.controller';
import { createModule } from './registry';

/* ------------------------------ Attendance ----------------------------- */

export const attendanceModule = createModule('Attendance', '/api/v1/attendance');
const CAPTURE_NOTE =
  'Optional `photoId` (fresh upload from `POST /files` with context ATTENDANCE, not used before) and `latitude`/`longitude`/`accuracy`. Required when the organization enables `settings.attendance.requireSelfie` (SELFIE_REQUIRED) / `requireLocation` (LOCATION_REQUIRED); an unusable photo fails with INVALID_SELFIE.';
attendanceModule.route({ method: 'post', path: '/check-in', summary: 'Clock in (self)', description: CAPTURE_NOTE, body: clockInSchema }, att.checkIn);
attendanceModule.route({ method: 'post', path: '/check-out', summary: 'Clock out (self)', description: CAPTURE_NOTE, body: clockOutSchema }, att.checkOut);
attendanceModule.route({ method: 'post', path: '/break/start', summary: 'Start a break (self)' }, att.breakStart);
attendanceModule.route({ method: 'post', path: '/break/end', summary: 'End the current break (self)' }, att.breakEnd);
attendanceModule.route({ method: 'get', path: '/today', summary: 'My attendance today: record, shift and live state' }, att.today);
attendanceModule.route(
  {
    method: 'get',
    path: '/summary',
    summary: 'Per-employee attendance summary for a period (default: current month; scoped)',
    query: attendanceSummaryQuery,
  },
  att.summary,
);
attendanceModule.route(
  {
    method: 'get',
    path: '/dashboard',
    summary: 'Attendance dashboard (org-wide or team) with trends',
    anyPermission: ['attendance:read', 'team:view'],
    query: attendanceDashboardQuery,
  },
  att.dashboard,
);
attendanceModule.route(
  {
    method: 'get',
    path: '/board',
    summary: 'Live attendance board: every employee in scope as a card, by today’s state',
    description:
      'Columns: NOT_IN (yet to clock in, incl. marked absent), WORKING, ON_BREAK, DONE (clocked out), AWAY (leave / holiday / week off). Cards carry clock times, late flag, work mode and clock-in place (inside/outside the office area). Scoped like the dashboard (org-wide with attendance:read, otherwise the team). Plain employees get scope `peers`: themselves, their manager and colleagues sharing that manager, with colleagues\' cards reduced to status only (`restricted`).',
    query: attendanceBoardQuery,
  },
  att.board,
);

// Regularization (attendance correction) — registered before `/:id`.
attendanceModule.route(
  {
    method: 'get',
    path: '/regularizations',
    summary: 'List attendance correction requests (scope: me | team | all | approvals)',
    query: paginationQuery.extend(regularizationListQuery.shape),
  },
  reg.list,
);
attendanceModule.route({ method: 'post', path: '/regularizations', summary: 'Request an attendance correction', body: regularizationSchema }, reg.submit);
attendanceModule.route({ method: 'get', path: '/regularizations/:id', summary: 'Get a correction request', params: idParam }, reg.get);
attendanceModule.route(
  { method: 'post', path: '/regularizations/:id/approve', summary: 'Approve the current step', permissions: ['attendance:approve'], params: idParam, body: commentBody },
  reg.approve,
);
attendanceModule.route(
  { method: 'post', path: '/regularizations/:id/reject', summary: 'Reject a correction request', permissions: ['attendance:approve'], params: idParam, body: rejectBody },
  reg.reject,
);
attendanceModule.route({ method: 'post', path: '/regularizations/:id/cancel', summary: 'Cancel my pending request', params: idParam }, reg.cancel);

attendanceModule.route(
  { method: 'get', path: '/', summary: 'List attendance records (scoped: all / team / self)', query: paginationQuery.extend(attendanceListQuery.shape) },
  att.list,
);
attendanceModule.route(
  { method: 'post', path: '/', summary: 'Record attendance for an employee', permissions: ['attendance:create'], body: attendanceCreateSchema },
  att.create,
);
attendanceModule.route({ method: 'get', path: '/:id', summary: 'Get an attendance record (IDOR-protected)', params: idParam }, att.get);
attendanceModule.route(
  { method: 'patch', path: '/:id', summary: 'Edit an attendance record (metrics recomputed, audited)', permissions: ['attendance:update'], params: idParam, body: attendanceUpdateSchema },
  att.update,
);

/* -------------------------------- Shifts ------------------------------- */

export const shiftModule = createModule('Shifts', '/api/v1/shifts');
shiftModule.route({ method: 'get', path: '/', summary: 'List shifts with employee counts', query: paginationQuery }, shift.list);
shiftModule.route({ method: 'get', path: '/all', summary: 'All shifts (for pickers)' }, shift.all);
shiftModule.route(
  { method: 'get', path: '/assignments', summary: 'Shift assignment history (scoped)', query: paginationQuery.extend(shiftAssignmentListQuery.shape) },
  shift.assignments,
);
shiftModule.route(
  { method: 'get', path: '/schedule', summary: 'Resolved shift per employee per day (max 31 days; scoped)', query: shiftScheduleQuery },
  shift.schedule,
);
shiftModule.route(
  { method: 'post', path: '/assign', summary: 'Assign a shift to employees or a department', permissions: ['shift:manage'], body: shiftAssignmentSchema },
  shift.assign,
);
shiftModule.route({ method: 'get', path: '/:id', summary: 'Get a shift', params: idParam }, shift.get);
shiftModule.route({ method: 'post', path: '/', summary: 'Create a shift', permissions: ['shift:manage'], body: shiftSchema }, shift.create);
shiftModule.route(
  { method: 'patch', path: '/:id', summary: 'Update a shift', permissions: ['shift:manage'], params: idParam, body: shiftUpdateSchema },
  shift.update,
);
shiftModule.route(
  { method: 'delete', path: '/:id', summary: 'Delete a shift (not default, no active assignments)', permissions: ['shift:manage'], params: idParam },
  shift.remove,
);

/* ------------------------------- Holidays ------------------------------ */

export const holidayModule = createModule('Holidays', '/api/v1/holidays');
holidayModule.route(
  { method: 'get', path: '/', summary: 'Holidays for a year (recurring expanded), optionally for a location', query: holidayListQuery },
  hol.list,
);
holidayModule.route({ method: 'get', path: '/upcoming', summary: 'Upcoming holidays for my location', query: holidayUpcomingQuery }, hol.upcoming);
holidayModule.route({ method: 'get', path: '/:id', summary: 'Get a holiday', params: idParam }, hol.get);
holidayModule.route({ method: 'post', path: '/', summary: 'Create a holiday', permissions: ['holiday:manage'], body: holidaySchema }, hol.create);
holidayModule.route(
  { method: 'patch', path: '/:id', summary: 'Update a holiday', permissions: ['holiday:manage'], params: idParam, body: holidayUpdateSchema },
  hol.update,
);
holidayModule.route({ method: 'delete', path: '/:id', summary: 'Delete a holiday', permissions: ['holiday:manage'], params: idParam }, hol.remove);
