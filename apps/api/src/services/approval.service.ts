import type { Types } from 'mongoose';
import type { ApproverType, Permission } from '@stencil/shared';
import type { ApprovalStep } from '../models/approval.schema';
import { can, type RequestContext } from '../types/context';
import { forbidden, unprocessable } from '../utils/errors';
import { getReportIds } from './scope.service';

/**
 * Reusable multi-step approval engine used by leave, attendance
 * regularization and expenses (payroll uses its own state machine because it
 * is organization-level rather than employee-level).
 *
 * A workflow is an ordered chain of approver types configured per
 * organization (Settings → Approvals). Each approvable document embeds
 * `approvalSteps`, `currentStep` and `currentApproverType`.
 */
export interface ApprovalPolicy {
  /** Permission required to act on any step. */
  approvePermission: Permission;
  /** Permission required to reject (defaults to approvePermission). */
  rejectPermission?: Permission;
  /** Permission identifying HR-level approvers (org-wide authority). */
  hrPermission: Permission;
  /** Permission identifying finance approvers. */
  financePermission?: Permission;
  /** Permission identifying payroll approvers. */
  payrollPermission?: Permission;
}

export interface Approvable {
  employeeId: Types.ObjectId;
  approvalSteps: ApprovalStep[];
  currentStep: number;
  currentApproverType?: string | null;
}

interface EmployeeLike {
  _id: Types.ObjectId;
  managerId?: Types.ObjectId | null;
}

/** Builds the step list for a new request. MANAGER is skipped when there is no manager. */
export const buildApprovalSteps = (chain: readonly ApproverType[], employee: EmployeeLike): ApprovalStep[] => {
  const steps: ApprovalStep[] = chain.map((approverType) => ({
    approverType,
    status: approverType === 'MANAGER' && !employee.managerId ? 'SKIPPED' : 'PENDING',
  }));
  // Always keep at least one actionable step so a request never auto-approves.
  if (!steps.some((s) => s.status === 'PENDING')) steps.push({ approverType: 'HR', status: 'PENDING' });
  return steps;
};

export const initApproval = <T extends Approvable>(doc: T, chain: readonly ApproverType[], employee: EmployeeLike) => {
  doc.approvalSteps = buildApprovalSteps(chain, employee);
  doc.currentStep = doc.approvalSteps.findIndex((s) => s.status === 'PENDING');
  doc.currentApproverType = doc.approvalSteps[doc.currentStep]?.approverType ?? null;
};

/** Can this user act on the given step for the given employee's request? */
export const canActOnStep = async (
  ctx: RequestContext,
  step: ApprovalStep,
  employee: EmployeeLike,
  policy: ApprovalPolicy,
  decision: 'APPROVE' | 'REJECT',
): Promise<boolean> => {
  // Nobody approves their own requests.
  if (ctx.employeeId?.equals(employee._id)) return false;
  // FINANCE / PAYROLL steps are acted on by holders of that dedicated permission
  // (e.g. `expense:pay`) even without the general approve/reject permission.
  if (step.approverType === 'FINANCE') return !!policy.financePermission && can(ctx, policy.financePermission);
  if (step.approverType === 'PAYROLL') return !!policy.payrollPermission && can(ctx, policy.payrollPermission);

  const required = decision === 'REJECT' ? (policy.rejectPermission ?? policy.approvePermission) : policy.approvePermission;
  if (!can(ctx, required)) return false;

  switch (step.approverType) {
    case 'MANAGER': {
      if (!ctx.employeeId) return can(ctx, policy.hrPermission);
      if (employee.managerId && ctx.employeeId.equals(employee.managerId)) return true;
      // Skip-level managers and HR may act on behalf of an unavailable manager.
      if (can(ctx, policy.hrPermission)) return true;
      const reports = await getReportIds(ctx.organizationId, ctx.employeeId);
      return reports.some((id) => id.equals(employee._id));
    }
    case 'HR':
      return can(ctx, policy.hrPermission);
    default:
      return false;
  }
};

export type ApprovalOutcome = 'APPROVED' | 'PENDING' | 'REJECTED';

/**
 * Applies a decision to the current step. Returns the overall outcome:
 * `APPROVED` when the final step is approved, `REJECTED` on any rejection,
 * `PENDING` when further steps remain.
 */
export const applyDecision = async <T extends Approvable>(
  ctx: RequestContext,
  doc: T,
  employee: EmployeeLike,
  policy: ApprovalPolicy,
  decision: 'APPROVE' | 'REJECT',
  comment?: string,
): Promise<ApprovalOutcome> => {
  const step = doc.approvalSteps[doc.currentStep];
  if (!step || step.status !== 'PENDING') throw unprocessable('There is no pending approval step', 'NO_PENDING_STEP');
  if (!(await canActOnStep(ctx, step, employee, policy, decision))) {
    throw forbidden(`This request is awaiting ${step.approverType.toLowerCase()} approval`);
  }

  step.status = decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
  step.actedBy = ctx.userId;
  step.actedByName = ctx.userName;
  step.actedAt = new Date();
  step.comment = comment;

  if (decision === 'REJECT') {
    doc.currentApproverType = null;
    return 'REJECTED';
  }
  const next = doc.approvalSteps.findIndex((s, i) => i > doc.currentStep && s.status === 'PENDING');
  if (next === -1) {
    doc.currentApproverType = null;
    return 'APPROVED';
  }
  doc.currentStep = next;
  doc.currentApproverType = doc.approvalSteps[next]!.approverType;
  return 'PENDING';
};

/** Marks remaining steps as skipped (used on cancellation). */
export const closeApproval = <T extends Approvable>(doc: T) => {
  for (const s of doc.approvalSteps) if (s.status === 'PENDING') s.status = 'SKIPPED';
  doc.currentApproverType = null;
};

/**
 * Mongo filter for requests awaiting the current user's action.
 * Returns `null` when the user cannot approve anything.
 */
export const approvalQueueFilter = async (ctx: RequestContext, policy: ApprovalPolicy) => {
  const or: Record<string, unknown>[] = [];
  const self = ctx.employeeId ? { employeeId: { $ne: ctx.employeeId } } : {};
  if (can(ctx, policy.approvePermission)) {
    if (can(ctx, policy.hrPermission)) {
      or.push({ currentApproverType: { $in: ['MANAGER', 'HR'] }, ...self });
    } else if (ctx.employeeId) {
      const reports = await getReportIds(ctx.organizationId, ctx.employeeId);
      if (reports.length) or.push({ currentApproverType: 'MANAGER', employeeId: { $in: reports } });
    }
  }
  if (policy.financePermission && can(ctx, policy.financePermission)) or.push({ currentApproverType: 'FINANCE', ...self });
  if (policy.payrollPermission && can(ctx, policy.payrollPermission)) or.push({ currentApproverType: 'PAYROLL', ...self });
  return or.length ? { $or: or } : null;
};
