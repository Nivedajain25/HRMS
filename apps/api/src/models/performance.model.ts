import { Schema, model, type InferSchemaType } from 'mongoose';
import { CYCLE_STATUS, GOAL_CATEGORIES, GOAL_STATUS, REVIEW_STATUS } from '@stencil/shared';
import { baseSchemaOptions, ref, softDeleteField, tenantField } from './plugins';

const performanceCycleSchema = new Schema(
  {
    ...tenantField,
    name: { type: String, required: true },
    description: String,
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    selfReviewDue: Date,
    managerReviewDue: Date,
    status: { type: String, enum: CYCLE_STATUS, default: 'DRAFT' },
    ratingScale: {
      min: { type: Number, default: 1 },
      max: { type: Number, default: 5 },
      labels: { type: [{ _id: false, value: Number, label: String }], default: [] },
    },
    goalWeightage: { type: Number, default: 70 },
    competencies: [String],
    departmentIds: [{ type: Schema.Types.ObjectId, ref: 'Department' }],
    createdBy: ref('User'),
    ...softDeleteField,
  },
  baseSchemaOptions,
);
performanceCycleSchema.index({ organizationId: 1, startDate: -1 });
export type PerformanceCycle = InferSchemaType<typeof performanceCycleSchema>;
export const PerformanceCycleModel = model('PerformanceCycle', performanceCycleSchema);

const goalSchema = new Schema(
  {
    ...tenantField,
    title: { type: String, required: true },
    description: String,
    category: { type: String, enum: GOAL_CATEGORIES, default: 'KPI' },
    weight: { type: Number, default: 0, min: 0, max: 100 },
    target: String,
    metricUnit: String,
    targetValue: Number,
    progress: { type: Number, default: 0, min: 0, max: 100 },
    dueDate: Date,
    status: { type: String, enum: GOAL_STATUS, default: 'NOT_STARTED' },
    employeeId: ref('Employee', true),
    managerId: ref('Employee'),
    cycleId: ref('PerformanceCycle'),
    parentGoalId: ref('Goal'),
    keyResults: { type: [{ _id: false, title: String, progress: Number }], default: [] },
    updates: {
      type: [{ _id: false, progress: Number, status: String, note: String, by: Schema.Types.ObjectId, at: Date }],
      default: [],
    },
    createdBy: ref('User'),
    ...softDeleteField,
  },
  baseSchemaOptions,
);
goalSchema.index({ organizationId: 1, employeeId: 1, status: 1 });
goalSchema.index({ organizationId: 1, cycleId: 1 });
export type Goal = InferSchemaType<typeof goalSchema>;
export const GoalModel = model('Goal', goalSchema);

const reviewSectionSchema = new Schema(
  {
    ratings: {
      type: [{ _id: false, goalId: Schema.Types.ObjectId, competency: String, rating: Number, comment: String }],
      default: [],
    },
    overallRating: Number,
    strengths: String,
    improvements: String,
    comments: String,
    submittedAt: Date,
    submittedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { _id: false },
);

const performanceReviewSchema = new Schema(
  {
    ...tenantField,
    cycleId: ref('PerformanceCycle', true),
    employeeId: ref('Employee', true),
    managerId: ref('Employee'),
    status: { type: String, enum: REVIEW_STATUS, default: 'PENDING_SELF' },
    selfReview: { type: reviewSectionSchema, default: null },
    managerReview: { type: reviewSectionSchema, default: null },
    hrReview: { type: reviewSectionSchema, default: null },
    goalScore: Number,
    finalRating: Number,
    finalRatingLabel: String,
    completedAt: Date,
  },
  baseSchemaOptions,
);
performanceReviewSchema.index({ organizationId: 1, cycleId: 1, employeeId: 1 }, { unique: true });
performanceReviewSchema.index({ organizationId: 1, managerId: 1, status: 1 });
performanceReviewSchema.index({ organizationId: 1, employeeId: 1, createdAt: -1 });
export type PerformanceReview = InferSchemaType<typeof performanceReviewSchema>;
export const PerformanceReviewModel = model('PerformanceReview', performanceReviewSchema);

const feedbackSchema = new Schema(
  {
    ...tenantField,
    employeeId: ref('Employee', true),
    fromUserId: ref('User', true),
    fromName: String,
    message: { type: String, required: true },
    type: { type: String, enum: ['PRAISE', 'CONSTRUCTIVE', 'GENERAL'], default: 'GENERAL' },
    visibility: { type: String, enum: ['PRIVATE', 'MANAGER', 'PUBLIC'], default: 'MANAGER' },
  },
  baseSchemaOptions,
);
feedbackSchema.index({ organizationId: 1, employeeId: 1, createdAt: -1 });
export type Feedback = InferSchemaType<typeof feedbackSchema>;
export const FeedbackModel = model('Feedback', feedbackSchema);
