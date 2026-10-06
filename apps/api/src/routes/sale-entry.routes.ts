import {
  architectMeetingListQuery,
  architectMeetingSchema,
  architectMeetingUpdateSchema,
  idParam,
  saleEntryListQuery,
  saleEntrySchema,
  saleEntryUpdateSchema,
  saleSummaryQuery,
  salesTargetQuery,
  salesTargetSchema,
} from '@stencil/shared';
import { architectMeetingController as a, saleEntryController as s, salesTargetController as t } from '../controllers/sale-entry.controller';
import { createModule } from './registry';

/**
 * Individual sales: each employee records their own sales and sees their totals; people who see the company sales
 * (report:read or employee:read) can use `scope=all` for everyone's.
 */
export const saleEntryModule = createModule('Individual sales', '/api/v1/sales/entries');
saleEntryModule.route({ method: 'get', path: '/', summary: 'My sales (or everyone’s with scope=all)', query: saleEntryListQuery }, s.list);
saleEntryModule.route({ method: 'get', path: '/summary', summary: 'Totals, monthly series and (scope=all) per-employee totals', query: saleSummaryQuery }, s.summary);
saleEntryModule.route({ method: 'post', path: '/', summary: 'Record one of my sales', body: saleEntrySchema }, s.create);
saleEntryModule.route({ method: 'patch', path: '/:id', summary: 'Edit a sale (owner, or HR / admin)', params: idParam, body: saleEntryUpdateSchema }, s.update);
saleEntryModule.route({ method: 'delete', path: '/:id', summary: 'Delete a sale (owner, or HR / admin)', params: idParam }, s.remove);

/** Monthly sales targets per employee (board: report:read / employee:read; setting: employee:update). */
export const salesTargetModule = createModule('Sales targets', '/api/v1/sales/targets');
salesTargetModule.route({ method: 'get', path: '/', summary: 'Target vs achieved for every employee in a month', query: salesTargetQuery }, t.board);
salesTargetModule.route({ method: 'put', path: '/', summary: 'Set or clear an employee’s target for a month', body: salesTargetSchema }, t.set);

/** Architect meetings: employees log their own; HR / admin see everyone's with scope=all. */
export const architectMeetingModule = createModule('Architect meetings', '/api/v1/sales/architects');
architectMeetingModule.route({ method: 'get', path: '/', summary: 'My architect meetings (or everyone’s with scope=all)', query: architectMeetingListQuery }, a.list);
architectMeetingModule.route({ method: 'post', path: '/', summary: 'Log an architect meeting', body: architectMeetingSchema }, a.create);
architectMeetingModule.route({ method: 'patch', path: '/:id', summary: 'Edit a meeting (owner, or HR / admin)', params: idParam, body: architectMeetingUpdateSchema }, a.update);
architectMeetingModule.route({ method: 'delete', path: '/:id', summary: 'Delete a meeting (owner, or HR / admin)', params: idParam }, a.remove);
