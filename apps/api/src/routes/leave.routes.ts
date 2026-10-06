import {
  commentBody,
  idParam,
  leaveBalanceAdjustSchema,
  leaveBalanceQuery,
  leaveCalendarQuery,
  leaveCancelSchema,
  leaveCarryForwardSchema,
  leaveListQuery,
  leavePreviewSchema,
  leaveRequestSchema,
  leaveRequestUpdateSchema,
  leaveTypeListQuery,
  leaveTypeSchema,
  leaveTypeUpdateSchema,
  paginationQuery,
  rejectBody,
} from '@stencil/shared';
import { leaveController as lv, leaveTypeController as lt } from '../controllers/leave.controller';
import { createModule } from './registry';

export const leaveTypeModule = createModule('Leave Types', '/api/v1/leave-types');
leaveTypeModule.route({ method: 'get', path: '/', summary: 'List leave types', query: leaveTypeListQuery }, lt.list);
leaveTypeModule.route({ method: 'get', path: '/all', summary: 'All active leave types (for pickers)' }, lt.all);
leaveTypeModule.route({ method: 'get', path: '/:id', summary: 'Get a leave type', params: idParam }, lt.get);
leaveTypeModule.route({ method: 'post', path: '/', summary: 'Create a leave type', permissions: ['leave_type:manage'], body: leaveTypeSchema }, lt.create);
leaveTypeModule.route(
  { method: 'patch', path: '/:id', summary: 'Update a leave type', permissions: ['leave_type:manage'], params: idParam, body: leaveTypeUpdateSchema },
  lt.update,
);
leaveTypeModule.route(
  {
    method: 'delete',
    path: '/:id',
    summary: 'Archive a leave type',
    description: 'Soft delete. Blocked while requests of this type are awaiting approval.',
    permissions: ['leave_type:manage'],
    params: idParam,
  },
  lt.remove,
);

export const leaveModule = createModule('Leave', '/api/v1/leaves');
leaveModule.route(
  {
    method: 'get',
    path: '/',
    summary: 'List leave requests (scoped: me / team / all / approvals)',
    description: '`scope=approvals` returns requests awaiting the current user\'s decision. Drafts are only visible to their requester.',
    query: paginationQuery.extend(leaveListQuery.shape),
  },
  lv.list,
);
leaveModule.route(
  {
    method: 'get',
    path: '/balances',
    summary: 'Leave balances (self by default; others need leave:read or be their manager)',
    query: leaveBalanceQuery,
  },
  lv.balances,
);
leaveModule.route(
  { method: 'post', path: '/balances/adjust', summary: 'Adjust a leave balance', permissions: ['leave:update'], body: leaveBalanceAdjustSchema },
  lv.adjust,
);
leaveModule.route(
  {
    method: 'post',
    path: '/balances/carry-forward',
    summary: 'Carry forward unused leave into the next year',
    permissions: ['leave:update'],
    body: leaveCarryForwardSchema,
  },
  lv.carryForward,
);
leaveModule.route(
  {
    method: 'get',
    path: '/calendar',
    summary: 'Leave calendar with holidays (max 62 days)',
    description: 'Colleagues\' leave is shown with minimal fields to employees without leave:read / team:view.',
    query: leaveCalendarQuery,
  },
  lv.calendar,
);
leaveModule.route(
  {
    method: 'post',
    path: '/preview',
    summary: 'Preview days and balance impact of a leave request (reason optional; `excludeId` = request being edited)',
    body: leavePreviewSchema,
  },
  lv.preview,
);
leaveModule.route(
  {
    method: 'post',
    path: '/',
    summary: 'Apply for leave (or save a draft)',
    description: '`employeeId` (apply on behalf) requires leave:create. `saveAsDraft` saves without reserving balance.',
    body: leaveRequestSchema,
  },
  lv.create,
);
leaveModule.route({ method: 'get', path: '/:id', summary: 'Get a leave request (IDOR-protected)', params: idParam }, lv.get);
leaveModule.route(
  {
    method: 'patch',
    path: '/:id',
    summary: 'Edit a draft (or a submitted request before any approval)',
    params: idParam,
    body: leaveRequestUpdateSchema,
  },
  lv.update,
);
leaveModule.route({ method: 'post', path: '/:id/submit', summary: 'Submit a draft leave request', params: idParam }, lv.submit);
leaveModule.route(
  { method: 'post', path: '/:id/approve', summary: 'Approve leave (current approval step)', permissions: ['leave:approve'], params: idParam, body: commentBody },
  lv.approve,
);
leaveModule.route(
  { method: 'post', path: '/:id/reject', summary: 'Reject leave', permissions: ['leave:reject'], params: idParam, body: rejectBody },
  lv.reject,
);
leaveModule.route(
  {
    method: 'post',
    path: '/:id/cancel',
    summary: 'Cancel leave (requester, or HR with leave:update)',
    description: 'Requesters can cancel pending leave and approved leave that has not started; HR can cancel any approved leave.',
    params: idParam,
    body: leaveCancelSchema,
  },
  lv.cancel,
);
