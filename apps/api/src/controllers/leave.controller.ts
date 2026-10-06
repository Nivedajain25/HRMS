import type { Request } from 'express';
import type { z } from 'zod';
import type {
  PaginationQuery,
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
} from '@stencil/shared';
import { body, query } from '../middleware/validate';
import * as leave from '../services/leave.service';
import * as leaveTypes from '../services/leave-type.service';
import { handle, handleCreated, handlePaged, idOf } from '../utils/controller';

type Out<T extends z.ZodType> = z.output<T>;

export const leaveTypeController = {
  list: handlePaged((ctx, req) => leaveTypes.listLeaveTypes(ctx, query<Out<typeof leaveTypeListQuery>>(req))),
  all: handle((ctx) => leaveTypes.allLeaveTypes(ctx)),
  get: handle((ctx, req) => leaveTypes.getLeaveType(ctx, idOf(req))),
  create: handleCreated((ctx, req) => leaveTypes.createLeaveType(ctx, body<Out<typeof leaveTypeSchema>>(req)), 'Leave type created'),
  update: handle((ctx, req) => leaveTypes.updateLeaveType(ctx, idOf(req), body<Out<typeof leaveTypeUpdateSchema>>(req)), 'Leave type updated'),
  remove: handle((ctx, req) => leaveTypes.archiveLeaveType(ctx, idOf(req)), 'Leave type archived'),
};

const reqBody = (req: Request) => body<Out<typeof leaveRequestSchema>>(req);

export const leaveController = {
  list: handlePaged((ctx, req) => leave.listLeaves(ctx, query<PaginationQuery & Out<typeof leaveListQuery>>(req))),
  get: handle((ctx, req) => leave.getLeave(ctx, idOf(req))),
  create: handleCreated(
    (ctx, req) => leave.createLeave(ctx, reqBody(req)),
    'Leave request saved',
  ),
  update: handle((ctx, req) => leave.updateLeave(ctx, idOf(req), body<Out<typeof leaveRequestUpdateSchema>>(req)), 'Leave request updated'),
  submit: handle((ctx, req) => leave.submitLeave(ctx, idOf(req)), 'Leave request submitted'),
  approve: handle((ctx, req) => leave.approveLeave(ctx, idOf(req), body<{ comment?: string }>(req).comment), 'Leave approved'),
  reject: handle((ctx, req) => leave.rejectLeave(ctx, idOf(req), body<{ reason: string }>(req).reason), 'Leave rejected'),
  cancel: handle((ctx, req) => leave.cancelLeave(ctx, idOf(req), body<Out<typeof leaveCancelSchema>>(req).reason), 'Leave cancelled'),
  preview: handle((ctx, req) => leave.previewLeave(ctx, body<Out<typeof leavePreviewSchema>>(req))),
  balances: handle((ctx, req) => leave.getBalances(ctx, query<Out<typeof leaveBalanceQuery>>(req))),
  adjust: handle((ctx, req) => leave.adjustLeaveBalance(ctx, body<Out<typeof leaveBalanceAdjustSchema>>(req)), 'Leave balance adjusted'),
  carryForward: handle(
    (ctx, req) => leave.runCarryForward(ctx, body<Out<typeof leaveCarryForwardSchema>>(req).fromYear),
    'Carry forward completed',
  ),
  calendar: handle((ctx, req) => leave.leaveCalendar(ctx, query<Out<typeof leaveCalendarQuery>>(req))),
};
