import { z } from 'zod';
import {
  CANDIDATE_SOURCES,
  CANDIDATE_STAGES,
  CYCLE_STATUS,
  EMPLOYMENT_TYPES,
  EXIT_TYPES,
  GOAL_CATEGORIES,
  GOAL_STATUS,
  INTERVIEW_STATUS,
  INTERVIEW_TYPES,
  JOB_STATUS,
  ONBOARDING_TASK_CATEGORIES,
  TASK_ASSIGNEE,
  TASK_STATUS,
} from '../enums';
import {
  dateString,
  email,
  money,
  nullableDateString,
  nullableObjectId,
  objectId,
  optionalDateString,
  optionalEnum,
  optionalObjectId,
  optionalPhone,
  optionalString,
  patchSchema,
  percent,
  requiredString,
  timeString,
} from './common';

/** PATCH string field: `null` or a blank string clears the stored value. */
const nullableString = (max = 500) =>
  z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
    z.string().trim().max(max).nullable().optional(),
  );

/* ---------------------------- Performance --------------------------- */

export const ratingScaleSchema = z
  .object({
    min: z.coerce.number().int().min(0).max(10),
    max: z.coerce.number().int().min(1).max(10),
    labels: z.array(z.object({ value: z.number().int(), label: z.string().trim().min(1).max(40) })).max(11),
  })
  .refine((s) => s.max > s.min, { message: 'Maximum must be greater than minimum', path: ['max'] })
  .refine((s) => s.labels.every((l) => l.value >= s.min && l.value <= s.max), {
    message: 'Label values must lie within the scale',
    path: ['labels'],
  })
  .refine((s) => new Set(s.labels.map((l) => l.value)).size === s.labels.length, {
    message: 'Label values must be unique',
    path: ['labels'],
  });

export const DEFAULT_RATING_SCALE = {
  min: 1,
  max: 5,
  labels: [
    { value: 1, label: 'Needs improvement' },
    { value: 2, label: 'Below expectations' },
    { value: 3, label: 'Meets expectations' },
    { value: 4, label: 'Exceeds expectations' },
    { value: 5, label: 'Outstanding' },
  ],
};

const performanceCycleBaseSchema = z.object({
  name: requiredString('Name', 120),
  description: optionalString(1000),
  startDate: dateString,
  endDate: dateString,
  selfReviewDue: optionalDateString,
  managerReviewDue: optionalDateString,
  ratingScale: ratingScaleSchema.default(DEFAULT_RATING_SCALE),
  goalWeightage: percent.default(70),
  competencies: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
  departmentIds: z.array(objectId).default([]),
});

export const performanceCycleSchema = performanceCycleBaseSchema.refine((d) => d.endDate > d.startDate, {
  message: 'End must be after start',
  path: ['endDate'],
});
export type PerformanceCycleInput = z.input<typeof performanceCycleSchema>;

/** PATCH body for a cycle (date order is re-checked against the stored values). */
export const performanceCycleUpdateSchema = patchSchema(performanceCycleBaseSchema)
  .extend({
    /** `null` / `''` clears a due date. */
    selfReviewDue: nullableDateString,
    managerReviewDue: nullableDateString,
  })
  .refine(
  (d) => !d.startDate || !d.endDate || d.endDate > d.startDate,
  { message: 'End must be after start', path: ['endDate'] },
);

/** Advance a cycle to its next stage (or an explicit, workflow-valid stage). */
export const cycleAdvanceSchema = z.object({ status: z.enum(CYCLE_STATUS).optional() });

export const goalSchema = z.object({
  title: requiredString('Title', 200),
  description: optionalString(2000),
  category: z.enum(GOAL_CATEGORIES).default('KPI'),
  weight: percent.default(0),
  target: optionalString(200),
  metricUnit: optionalString(40),
  targetValue: z.coerce.number().optional(),
  progress: percent.default(0),
  dueDate: optionalDateString,
  status: z.enum(GOAL_STATUS).default('NOT_STARTED'),
  employeeId: objectId,
  cycleId: optionalObjectId,
  parentGoalId: optionalObjectId,
  keyResults: z
    .array(z.object({ title: z.string().trim().min(1).max(200), progress: percent.default(0) }))
    .max(10)
    .default([]),
});
export type GoalInput = z.input<typeof goalSchema>;

/** PATCH body for a goal. The owner (employeeId) cannot be changed. */
export const goalUpdateSchema = patchSchema(goalSchema.omit({ employeeId: true, progress: true })).extend({
  /** `null` / `''` clears the due date / detaches the goal from its cycle or parent. */
  dueDate: nullableDateString,
  cycleId: nullableObjectId,
  parentGoalId: nullableObjectId,
});

export const goalProgressSchema = z.object({
  progress: percent,
  status: optionalEnum(GOAL_STATUS),
  note: optionalString(1000),
  keyResults: z.array(z.object({ title: z.string().max(200), progress: percent })).max(10).optional(),
});

const ratingEntry = z.object({
  goalId: optionalObjectId,
  competency: optionalString(80),
  rating: z.coerce.number().min(0).max(10),
  comment: optionalString(2000),
});
export const reviewSubmitSchema = z.object({
  ratings: z.array(ratingEntry).max(60).default([]),
  overallRating: z.coerce.number().min(0).max(10),
  strengths: optionalString(3000),
  improvements: optionalString(3000),
  comments: optionalString(3000),
});
export type ReviewSubmitInput = z.input<typeof reviewSubmitSchema>;

/** HR/final review: `overallRating` optionally overrides the manager's overall rating. */
export const hrReviewSubmitSchema = reviewSubmitSchema.extend({
  overallRating: z.coerce.number().min(0).max(10).optional(),
});
export type HrReviewSubmitInput = z.input<typeof hrReviewSubmitSchema>;

export const feedbackSchema = z.object({
  employeeId: objectId,
  message: requiredString('Feedback', 2000),
  type: z.enum(['PRAISE', 'CONSTRUCTIVE', 'GENERAL']).default('GENERAL'),
  visibility: z.enum(['PRIVATE', 'MANAGER', 'PUBLIC']).default('MANAGER'),
});

/* ---------------------------- Recruitment --------------------------- */

export const jobOpeningSchema = z.object({
  title: requiredString('Title', 150),
  departmentId: nullableObjectId,
  designationId: nullableObjectId,
  locationId: nullableObjectId,
  employmentType: z.enum(EMPLOYMENT_TYPES).default('FULL_TIME'),
  openings: z.coerce.number().int().min(1).max(500).default(1),
  experienceMin: z.coerce.number().min(0).max(50).default(0),
  experienceMax: z.coerce.number().min(0).max(50).default(0),
  salaryMin: money.default(0),
  salaryMax: money.default(0),
  currency: z.string().length(3).optional(),
  skills: z.array(z.string().trim().min(1).max(50)).max(30).default([]),
  description: requiredString('Description', 10000),
  requirements: optionalString(10000),
  status: z.enum(JOB_STATUS).default('DRAFT'),
  hiringManagerId: nullableObjectId,
  closingDate: optionalDateString,
});
export type JobOpeningInput = z.input<typeof jobOpeningSchema>;

/** PATCH body for a job; status changes go through `jobStatusSchema`. */
export const jobOpeningUpdateSchema = patchSchema(jobOpeningSchema.omit({ status: true })).extend({
  /** `null` / `''` clears the closing date. */
  closingDate: nullableDateString,
});
export const jobStatusSchema = z.object({ status: z.enum(JOB_STATUS) });

export const candidateSchema = z.object({
  jobId: objectId,
  firstName: requiredString('First name', 60),
  lastName: requiredString('Last name', 60),
  email,
  phone: optionalPhone,
  resumeFileId: optionalObjectId,
  skills: z.array(z.string().trim().min(1).max(50)).max(30).default([]),
  experienceYears: z.coerce.number().min(0).max(60).default(0),
  currentCompany: optionalString(120),
  currentSalary: money.optional(),
  expectedSalary: money.optional(),
  noticePeriodDays: z.coerce.number().int().min(0).max(365).optional(),
  source: z.enum(CANDIDATE_SOURCES).default('CAREERS_PAGE'),
  /** The employee who referred them (only kept when `source` is REFERRAL); `null` / `''` clears it. */
  referredBy: nullableObjectId,
  notes: optionalString(3000),
});
export type CandidateInput = z.input<typeof candidateSchema>;

/** PATCH body for a candidate; job and stage cannot be changed here. */
export const candidateUpdateSchema = patchSchema(candidateSchema.omit({ jobId: true })).extend({
  rating: z.coerce.number().min(0).max(5).optional(),
});

export const candidateStageSchema = z.object({
  stage: z.enum(CANDIDATE_STAGES),
  note: optionalString(1000),
  rejectionReason: optionalString(500),
});

export const interviewSchema = z.object({
  candidateId: objectId,
  interviewerIds: z.array(objectId).min(1, 'Select at least one interviewer').max(10),
  date: dateString,
  startTime: timeString,
  durationMinutes: z.coerce.number().int().min(10).max(480).default(60),
  type: z.enum(INTERVIEW_TYPES).default('VIDEO'),
  round: z.coerce.number().int().min(1).max(20).default(1),
  meetingLink: z.preprocess((v) => (v === '' ? undefined : v), z.url().optional()),
  location: optionalString(200),
  notes: optionalString(1000),
});
export type InterviewInput = z.input<typeof interviewSchema>;

/** Reschedule / edit a scheduled interview. */
export const interviewUpdateSchema = patchSchema(interviewSchema.omit({ candidateId: true })).extend({
  /** `null` / `''` clears the value. */
  meetingLink: z.preprocess((v) => (v === '' ? null : v), z.url().nullable().optional()),
  location: nullableString(200),
  notes: nullableString(1000),
});

export const interviewFeedbackSchema = z.object({
  rating: z.coerce.number().int().min(1).max(5),
  feedback: requiredString('Feedback', 5000),
  recommendation: z.enum(['STRONG_HIRE', 'HIRE', 'NO_HIRE', 'STRONG_NO_HIRE']),
});

export const interviewStatusSchema = z.object({ status: z.enum(INTERVIEW_STATUS), reason: optionalString(500) });

export const hireCandidateSchema = z.object({
  joiningDate: dateString,
  workEmail: email,
  departmentId: nullableObjectId,
  designationId: nullableObjectId,
  locationId: nullableObjectId,
  managerId: nullableObjectId,
  employmentType: z.enum(EMPLOYMENT_TYPES).default('FULL_TIME'),
  onboardingTemplateId: optionalObjectId,
  createUserAccount: z.boolean().default(true),
});
export type HireCandidateInput = z.input<typeof hireCandidateSchema>;

/* ---------------------- Onboarding / Offboarding --------------------- */

export const onboardingTaskTemplateSchema = z.object({
  title: requiredString('Title', 200),
  description: optionalString(1000),
  category: z.enum(ONBOARDING_TASK_CATEGORIES).default('OTHER'),
  assignee: z.enum(TASK_ASSIGNEE).default('HR'),
  dueInDays: z.coerce.number().int().min(-60).max(180).default(0),
  required: z.boolean().default(true),
});

export const onboardingTemplateSchema = z.object({
  name: requiredString('Name', 120),
  description: optionalString(500),
  departmentId: nullableObjectId,
  tasks: z.array(onboardingTaskTemplateSchema).min(1).max(100),
  isDefault: z.boolean().default(false),
});
export type OnboardingTemplateInput = z.input<typeof onboardingTemplateSchema>;

export const onboardingStartSchema = z.object({
  employeeId: objectId,
  templateId: objectId,
  startDate: optionalDateString,
});

export const taskStatusSchema = z.object({
  status: z.enum(TASK_STATUS),
  note: optionalString(1000),
});

export const offboardingCreateSchema = z.object({
  employeeId: objectId,
  exitType: z.enum(EXIT_TYPES),
  reason: requiredString('Reason', 2000),
  requestDate: dateString,
  lastWorkingDate: dateString,
});
export type OffboardingCreateInput = z.input<typeof offboardingCreateSchema>;

export const offboardingAdvanceSchema = z.object({
  note: optionalString(1000),
  exitInterview: z
    .object({
      reasonForLeaving: optionalString(500),
      rating: z.coerce.number().int().min(1).max(5).optional(),
      wouldRecommend: z.boolean().optional(),
      feedback: optionalString(5000),
    })
    .optional(),
  clearance: z
    .array(z.object({ department: z.string().trim().min(1).max(60), cleared: z.boolean(), note: optionalString(300) }))
    .max(20)
    .optional(),
  /** Final settlement payroll run (required to leave FINAL_PAYROLL unless a paid/approved payslip exists). */
  finalPayrollId: optionalObjectId,
});

export const offboardingCancelSchema = z.object({ note: optionalString(1000) });
