import { z } from 'zod';
import { AUDIT_ACTIONS, REPORT_TYPES, dateString, objectId, reportQuerySchema } from '@stencil/shared';
import { auditLogController as audit, dashboardController as dash, reportController as rep, searchController as srch } from '../controllers/insights.controller';
import { createModule } from './registry';

const optional = <T extends z.ZodType>(schema: T) => z.preprocess((v) => (v === '' || v === null ? undefined : v), schema.optional());

const auditLogQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  action: optional(z.enum(AUDIT_ACTIONS)),
  module: optional(z.string().trim().regex(/^[a-z_-]{1,40}$/i)),
  userId: optional(objectId),
  recordId: optional(objectId),
  from: optional(dateString),
  to: optional(dateString),
  search: optional(z.string().trim().max(100)),
});

export const auditLogModule = createModule('Audit logs', '/api/v1/audit-logs');
auditLogModule.route(
  {
    method: 'get',
    path: '/',
    summary: 'Audit trail (newest first)',
    description: 'Filters: `action`, `module`, `userId`, `recordId`, `from`/`to` (org-timezone days), `search` (record label / user name). Audit logs are append-only: no update or delete endpoints exist.',
    permissions: ['audit:read'],
    query: auditLogQuery,
  },
  audit.list,
);
auditLogModule.route(
  {
    method: 'get',
    path: '/record/:module/:recordId',
    summary: 'Activity for one record',
    description: 'Requires `audit:read`; for module `employees` the employee themself, their managers and `employee:read` holders may also view it.',
    params: z.object({ module: z.string().regex(/^[a-z_-]{1,40}$/i), recordId: objectId }),
  },
  audit.record,
);

export const searchModule = createModule('Search', '/api/v1/search');
searchModule.route(
  {
    method: 'get',
    path: '/',
    summary: 'Global search',
    description:
      'Case-insensitive search across employees (directory fields, visible to everyone), candidates (`recruitment:read`), departments, designations, assets, documents, leave requests and announcements, each respecting the module\'s visibility rules. `types` is a comma-separated subset; `limit` is per type.',
    query: z.object({
      q: z.string().trim().min(2, 'Enter at least 2 characters').max(100),
      types: optional(z.string().max(200)),
      limit: z.coerce.number().int().min(1).max(20).default(5),
    }),
  },
  srch.search,
);

export const dashboardModule = createModule('Dashboard', '/api/v1/dashboard');
dashboardModule.route(
  { method: 'get', path: '/admin', summary: 'Organization dashboard (cards, charts, widgets)', anyPermission: ['report:read', 'employee:read'] },
  dash.admin,
);
dashboardModule.route({ method: 'get', path: '/manager', summary: 'Team dashboard', permissions: ['team:view'] }, dash.manager);
dashboardModule.route({ method: 'get', path: '/employee', summary: 'My dashboard' }, dash.employee);
dashboardModule.route(
  {
    method: 'get',
    path: '/activity',
    summary: 'Recent activity feed (check in/out, leave, regularization, expenses, goals, onboarding tasks)',
    description: '`scope=all` (requires `employee:read` or `attendance:read`) covers every employee; otherwise only the caller’s own activity. `days` (1–31, default 7), `limit` (1–50, default 20).',
    query: z.object({
      scope: z.enum(['all', 'me']).optional(),
      limit: z.coerce.number().int().min(1).max(50).optional(),
      days: z.coerce.number().int().min(1).max(31).optional(),
    }),
  },
  dash.activity,
);

export const reportModule = createModule('Reports', '/api/v1/reports');
reportModule.route({ method: 'get', path: '/', summary: 'Report types available to me', permissions: ['report:read'] }, rep.list);
reportModule.route(
  {
    method: 'get',
    path: '/:type',
    summary: 'Run / export a report',
    description:
      '`format=json` returns `{ columns, rows, summary, pagination }` (max 5000 rows per page). `csv`, `xlsx` and `pdf` download a file named `stencil-<type>-report-<date>.<ext>`. Every report requires `report:read`; payroll also needs `payroll:read`, recruitment `recruitment:read`, expenses `expense:read`. Bank and identity numbers are never included.',
    permissions: ['report:read'],
    params: z.object({ type: z.enum(REPORT_TYPES) }),
    query: reportQuerySchema,
    binary: true,
  },
  rep.run,
);
