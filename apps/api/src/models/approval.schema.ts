import { Schema } from 'mongoose';
import { APPROVAL_STEP_STATUS, APPROVER_TYPES } from '@stencil/shared';

/**
 * Embedded approval trail shared by every approvable entity (leave,
 * regularization, expense). Driven by `services/approval.service.ts`.
 */
export const approvalStepSchema = new Schema(
  {
    approverType: { type: String, enum: APPROVER_TYPES, required: true },
    status: { type: String, enum: APPROVAL_STEP_STATUS, default: 'PENDING' },
    actedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    actedByName: String,
    actedAt: { type: Date, default: null },
    comment: String,
  },
  { _id: false },
);

export const approvalFields = {
  approvalSteps: { type: [approvalStepSchema], default: [] },
  currentStep: { type: Number, default: 0 },
  /** Denormalized type of the step awaiting action (null when decided) for queue queries. */
  currentApproverType: { type: String, enum: [...APPROVER_TYPES, null], default: null, index: true },
} as const;

export interface ApprovalStep {
  approverType: (typeof APPROVER_TYPES)[number];
  status: (typeof APPROVAL_STEP_STATUS)[number];
  actedBy?: unknown;
  actedByName?: string | null;
  actedAt?: Date | null;
  comment?: string | null;
}
