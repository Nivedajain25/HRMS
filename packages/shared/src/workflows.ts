import type {
  ApprovalStatus,
  AssetStatus,
  CandidateStage,
  CycleStatus,
  ExpenseStatus,
  OffboardingStatus,
  PayrollStatus,
  ReviewStatus,
} from './enums';

export type TransitionMap<S extends string> = Readonly<Record<S, readonly S[]>>;

export const defineStateMachine = <S extends string>(name: string, transitions: TransitionMap<S>) => ({
  name,
  transitions,
  can(from: S, to: S): boolean {
    return transitions[from]?.includes(to) ?? false;
  },
  next(from: S): readonly S[] {
    return transitions[from] ?? [];
  },
  isTerminal(state: S): boolean {
    return (transitions[state] ?? []).length === 0;
  },
});

export const LEAVE_WORKFLOW = defineStateMachine<ApprovalStatus>('leave', {
  DRAFT: ['SUBMITTED', 'CANCELLED'],
  SUBMITTED: ['PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'CANCELLED'],
  PENDING_APPROVAL: ['APPROVED', 'REJECTED', 'CANCELLED'],
  // Approved leave may still be cancelled (balance is restored).
  APPROVED: ['CANCELLED'],
  REJECTED: [],
  CANCELLED: [],
});

export const REGULARIZATION_WORKFLOW = defineStateMachine<ApprovalStatus>('regularization', {
  DRAFT: ['SUBMITTED', 'CANCELLED'],
  SUBMITTED: ['PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'CANCELLED'],
  PENDING_APPROVAL: ['APPROVED', 'REJECTED', 'CANCELLED'],
  APPROVED: [],
  REJECTED: [],
  CANCELLED: [],
});

export const EXPENSE_WORKFLOW = defineStateMachine<ExpenseStatus>('expense', {
  DRAFT: ['SUBMITTED', 'CANCELLED'],
  SUBMITTED: ['PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'CANCELLED'],
  PENDING_APPROVAL: ['APPROVED', 'REJECTED', 'CANCELLED'],
  APPROVED: ['PAID'],
  REJECTED: [],
  PAID: [],
  CANCELLED: [],
});

export const PAYROLL_WORKFLOW = defineStateMachine<PayrollStatus>('payroll', {
  DRAFT: ['PROCESSING', 'CANCELLED'],
  PROCESSING: ['REVIEW', 'DRAFT'],
  // From review, payroll can be re-processed (back to PROCESSING) or approved.
  REVIEW: ['PROCESSING', 'APPROVED', 'CANCELLED'],
  APPROVED: ['PAID', 'REVIEW'],
  PAID: [],
  CANCELLED: [],
});

export const ASSET_WORKFLOW = defineStateMachine<AssetStatus>('asset', {
  AVAILABLE: ['ASSIGNED', 'REPAIR', 'RETIRED'],
  ASSIGNED: ['AVAILABLE', 'REPAIR'],
  REPAIR: ['AVAILABLE', 'RETIRED'],
  RETIRED: [],
});

export const CANDIDATE_PIPELINE = defineStateMachine<CandidateStage>('candidate', {
  APPLIED: ['SCREENING', 'REJECTED'],
  SCREENING: ['SHORTLISTED', 'REJECTED'],
  SHORTLISTED: ['INTERVIEW', 'ASSESSMENT', 'REJECTED'],
  INTERVIEW: ['ASSESSMENT', 'SELECTED', 'REJECTED'],
  ASSESSMENT: ['INTERVIEW', 'SELECTED', 'REJECTED'],
  SELECTED: ['OFFERED', 'REJECTED'],
  OFFERED: ['HIRED', 'REJECTED'],
  HIRED: [],
  REJECTED: [],
});

export const PERFORMANCE_CYCLE_WORKFLOW = defineStateMachine<CycleStatus>('performance-cycle', {
  DRAFT: ['GOAL_SETTING'],
  GOAL_SETTING: ['IN_PROGRESS'],
  IN_PROGRESS: ['SELF_REVIEW'],
  SELF_REVIEW: ['MANAGER_REVIEW'],
  MANAGER_REVIEW: ['HR_REVIEW'],
  HR_REVIEW: ['COMPLETED'],
  COMPLETED: [],
});

export const PERFORMANCE_REVIEW_WORKFLOW = defineStateMachine<ReviewStatus>('performance-review', {
  PENDING_SELF: ['PENDING_MANAGER'],
  PENDING_MANAGER: ['PENDING_HR'],
  PENDING_HR: ['COMPLETED'],
  COMPLETED: [],
});

export const OFFBOARDING_WORKFLOW = defineStateMachine<OffboardingStatus>('offboarding', {
  EXIT_REQUEST: ['NOTICE_PERIOD', 'CANCELLED'],
  NOTICE_PERIOD: ['ASSET_RETURN', 'CANCELLED'],
  ASSET_RETURN: ['CLEARANCE'],
  CLEARANCE: ['FINAL_PAYROLL'],
  FINAL_PAYROLL: ['EXIT_INTERVIEW'],
  EXIT_INTERVIEW: ['DEACTIVATION'],
  DEACTIVATION: ['COMPLETED'],
  COMPLETED: [],
  CANCELLED: [],
});

export const OFFBOARDING_STEPS: OffboardingStatus[] = [
  'EXIT_REQUEST',
  'NOTICE_PERIOD',
  'ASSET_RETURN',
  'CLEARANCE',
  'FINAL_PAYROLL',
  'EXIT_INTERVIEW',
  'DEACTIVATION',
  'COMPLETED',
];
