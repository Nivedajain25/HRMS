import type { Request, Response } from 'express';
import type { ReportQueryOutput, ReportType } from '@stencil/shared';
import { getCtx } from '../middleware/auth';
import { query } from '../middleware/validate';
import * as activity from '../services/activity.service';
import * as auditLogs from '../services/audit-log.service';
import * as dashboards from '../services/dashboard.service';
import * as reports from '../services/report.service';
import * as search from '../services/search.service';
import { handle, handlePaged, idOf } from '../utils/controller';
import { ok } from '../utils/response';

export const auditLogController = {
  list: handlePaged((ctx, req) => auditLogs.listAuditLogs(ctx, query<auditLogs.AuditLogQuery>(req))),
  record: handle((ctx, req) => auditLogs.recordActivity(ctx, idOf(req, 'module'), idOf(req, 'recordId'))),
};

export const searchController = {
  search: handle((ctx, req) => search.globalSearch(ctx, query<search.SearchQuery>(req))),
};

export const dashboardController = {
  admin: handle((ctx) => dashboards.adminDashboard(ctx)),
  manager: handle((ctx) => dashboards.managerDashboard(ctx)),
  employee: handle((ctx) => dashboards.employeeDashboard(ctx)),
  activity: handle((ctx, req) => activity.activityFeed(ctx, query<{ scope?: 'all' | 'me'; limit?: number; days?: number }>(req))),
};

export const reportController = {
  list: handle(async (ctx) => reports.listReports(ctx)),
  /** JSON, or a streamed file download for csv / xlsx / pdf. */
  run: async (req: Request, res: Response) => {
    const out = await reports.runReport(getCtx(req), idOf(req, 'type') as ReportType, query<ReportQueryOutput>(req));
    if (out.kind === 'json') {
      ok(res, out.data);
      return;
    }
    res.setHeader('Content-Type', out.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${out.filename}"`);
    res.setHeader('Content-Length', String(out.buffer.length));
    res.setHeader('Cache-Control', 'no-store');
    res.end(out.buffer);
  },
};
