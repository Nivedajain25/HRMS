import type { Types } from 'mongoose';
import type { PaginationQuery } from '@stencil/shared';
import { logger } from '../config/logger';
import { EmployeeModel, NotificationModel, NotificationPreferenceModel, OrganizationModel, PayrollModel, PayslipModel, UserModel } from '../models';
import { periodLabel, renderPayslipPdf } from '../pdf/payslip.pdf';
import { can, type RequestContext } from '../types/context';
import { forbidden, notFound } from '../utils/errors';
import { buildSort, paginate } from '../utils/pagination';
import { sendEmail } from './email.service';

/** Statuses an employee may see on their own payslips (never DRAFT). */
const EMPLOYEE_VISIBLE = ['FINAL', 'PAID'];

const LIST_SELECT = '-employerContributions';

/**
 * Lists payslips. Default: the caller's own FINAL/PAID payslips.
 * `scope=all` or another employee's id requires `payroll:read`.
 */
export const listPayslips = async (
  ctx: RequestContext,
  q: PaginationQuery & { employeeId?: string; payrollId?: string; year?: number; month?: number; scope?: 'me' | 'all' },
) => {
  const own = !q.employeeId || (ctx.employeeId?.equals(q.employeeId) ?? false);
  const wantsOthers = q.scope === 'all' || !own;
  if (wantsOthers && !can(ctx, 'payroll:read')) throw forbidden('You can only view your own payslips');

  const filter: Record<string, unknown> = { organizationId: ctx.organizationId };
  if (wantsOthers) {
    if (q.employeeId) filter.employeeId = q.employeeId;
    filter.status = { $ne: 'CANCELLED' };
  } else {
    if (!ctx.employeeId) return { items: [], pagination: { page: q.page, limit: q.limit, total: 0, totalPages: 1 } };
    filter.employeeId = ctx.employeeId;
    filter.status = { $in: EMPLOYEE_VISIBLE };
  }
  if (q.payrollId) filter.payrollId = q.payrollId;
  if (q.year) filter.year = q.year;
  if (q.month) filter.month = q.month;
  return paginate(PayslipModel, {
    filter,
    page: q.page,
    limit: q.limit,
    sort: buildSort(q, ['year', 'month', 'netPay', 'createdAt'], { year: -1, month: -1, createdAt: -1 }),
    select: LIST_SELECT,
  });
};

/** IDOR-protected load: owner (FINAL/PAID only) or `payroll:read`. Foreign/hidden → 404. */
const loadPayslip = async (ctx: RequestContext, id: string) => {
  const slip = await PayslipModel.findOne({ _id: id, organizationId: ctx.organizationId }).lean();
  if (!slip) throw notFound('Payslip');
  if (can(ctx, 'payroll:read')) return slip;
  if (!ctx.employeeId?.equals(slip.employeeId)) throw forbidden('You do not have access to this payslip');
  if (!EMPLOYEE_VISIBLE.includes(slip.status ?? '')) throw notFound('Payslip');
  return slip;
};

export const getPayslip = async (ctx: RequestContext, id: string) => {
  const slip = await loadPayslip(ctx, id);
  const run = await PayrollModel.findOne({ _id: slip.payrollId, organizationId: ctx.organizationId })
    .select('month year status periodStart periodEnd isOffCycle')
    .lean();
  return { ...slip, payroll: run };
};

export const payslipPdf = async (ctx: RequestContext, id: string) => {
  const slip = await loadPayslip(ctx, id);
  const [org, run] = await Promise.all([
    OrganizationModel.findById(ctx.organizationId).select('name legalName address city state country postalCode email phone').lean(),
    PayrollModel.findOne({ _id: slip.payrollId, organizationId: ctx.organizationId }).select('periodStart periodEnd').lean(),
  ]);
  const buffer = await renderPayslipPdf({
    organization: { name: org?.name ?? 'Organization', ...org },
    payslip: { ...slip, periodStart: run?.periodStart, periodEnd: run?.periodEnd } as never,
  });
  const code = (slip.employeeSnapshot?.employeeId ?? String(slip.employeeId)).replace(/[^A-Za-z0-9_-]/g, '');
  return { buffer, filename: `payslip-${code}-${slip.year}-${String(slip.month).padStart(2, '0')}.pdf` };
};

/**
 * In-app notification (PAYROLL_GENERATED) + `payslip` email for each employee
 * of a paid run, honouring notification preferences. Never throws.
 */
export const notifyPayslipsPublished = async (ctx: RequestContext, payrollId: Types.ObjectId, label: string) => {
  try {
    const slips = await PayslipModel.find({ organizationId: ctx.organizationId, payrollId }).select('employeeId month year').lean();
    if (!slips.length) return;
    const employees = await EmployeeModel.find({ organizationId: ctx.organizationId, _id: { $in: slips.map((s) => s.employeeId) } })
      .select('userId')
      .lean();
    const userByEmployee = new Map(employees.filter((e) => e.userId).map((e) => [String(e._id), e.userId!]));
    const users = await UserModel.find({ organizationId: ctx.organizationId, _id: { $in: [...userByEmployee.values()] }, status: 'ACTIVE' })
      .select('email firstName')
      .lean();
    const userMap = new Map(users.map((u) => [String(u._id), u]));
    const prefs = await NotificationPreferenceModel.find({ userId: { $in: users.map((u) => u._id) } }).lean();
    const prefByUser = new Map(prefs.map((p) => [String(p.userId), p.preferences.find((x) => x.type === 'PAYROLL_GENERATED')]));

    const inApp: Record<string, unknown>[] = [];
    for (const slip of slips) {
      const userId = userByEmployee.get(String(slip.employeeId));
      const user = userId ? userMap.get(String(userId)) : undefined;
      if (!user) continue;
      const pref = prefByUser.get(String(user._id));
      const link = `/payslips/${slip._id}`;
      const period = periodLabel(slip.month, slip.year);
      if (pref?.inApp ?? true) {
        inApp.push({
          organizationId: ctx.organizationId,
          userId: user._id,
          type: 'PAYROLL_GENERATED',
          title: `Payslip for ${period}`,
          message: `Your payslip for ${label} is available.`,
          link,
          entityType: 'Payslip',
          entityId: slip._id,
        });
      }
      if (pref?.email ?? true) await sendEmail(user.email, 'payslip', { name: user.firstName, period, link }, ctx.organizationId);
    }
    if (inApp.length) await NotificationModel.insertMany(inApp);
  } catch (err) {
    logger.error({ err, payrollId: String(payrollId) }, 'Failed to notify payslips');
  }
};
