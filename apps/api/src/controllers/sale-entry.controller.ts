import { body, query } from '../middleware/validate';
import * as sales from '../services/sale-entry.service';
import { handle, handleCreated, handlePaged, idOf } from '../utils/controller';

export const saleEntryController = {
  list: handlePaged((ctx, req) => sales.listSales(ctx, query<Parameters<typeof sales.listSales>[1]>(req))),
  summary: handle((ctx, req) => sales.salesSummary(ctx, query<Parameters<typeof sales.salesSummary>[1]>(req))),
  create: handleCreated((ctx, req) => sales.createSale(ctx, body<Parameters<typeof sales.createSale>[1]>(req)), 'Sale added'),
  update: handle((ctx, req) => sales.updateSale(ctx, idOf(req), body<Parameters<typeof sales.updateSale>[2]>(req)), 'Sale updated'),
  remove: handle((ctx, req) => sales.deleteSale(ctx, idOf(req)), 'Sale deleted'),
};

export const salesTargetController = {
  board: handle((ctx, req) => sales.targetBoard(ctx, query<{ month: string }>(req))),
  set: handle((ctx, req) => sales.setTarget(ctx, body<Parameters<typeof sales.setTarget>[1]>(req)), 'Target saved'),
};

export const architectMeetingController = {
  list: handlePaged((ctx, req) => sales.listArchitectMeetings(ctx, query<Parameters<typeof sales.listArchitectMeetings>[1]>(req))),
  create: handleCreated((ctx, req) => sales.createArchitectMeeting(ctx, body<Parameters<typeof sales.createArchitectMeeting>[1]>(req)), 'Meeting added'),
  update: handle((ctx, req) => sales.updateArchitectMeeting(ctx, idOf(req), body<Parameters<typeof sales.updateArchitectMeeting>[2]>(req)), 'Meeting updated'),
  remove: handle((ctx, req) => sales.deleteArchitectMeeting(ctx, idOf(req)), 'Meeting deleted'),
};
