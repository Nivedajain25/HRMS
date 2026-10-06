import { Schema, model, type InferSchemaType } from 'mongoose';
import {
  EXIT_TYPES,
  OFFBOARDING_STATUS,
  ONBOARDING_TASK_CATEGORIES,
  TASK_ASSIGNEE,
  TASK_STATUS,
} from '@stencil/shared';
import { baseSchemaOptions, ref, softDeleteField, tenantField } from './plugins';

const templateTaskSchema = new Schema(
  {
    title: { type: String, required: true },
    description: String,
    category: { type: String, enum: ONBOARDING_TASK_CATEGORIES, default: 'OTHER' },
    assignee: { type: String, enum: TASK_ASSIGNEE, default: 'HR' },
    dueInDays: { type: Number, default: 0 },
    required: { type: Boolean, default: true },
  },
  { _id: false },
);

const onboardingTemplateSchema = new Schema(
  {
    ...tenantField,
    name: { type: String, required: true },
    description: String,
    departmentId: ref('Department'),
    tasks: { type: [templateTaskSchema], default: [] },
    isDefault: { type: Boolean, default: false },
    ...softDeleteField,
  },
  baseSchemaOptions,
);
onboardingTemplateSchema.index({ organizationId: 1, name: 1 }, { unique: true });
export type OnboardingTemplate = InferSchemaType<typeof onboardingTemplateSchema>;
export const OnboardingTemplateModel = model('OnboardingTemplate', onboardingTemplateSchema);

const onboardingTaskSchema = new Schema({
  title: { type: String, required: true },
  description: String,
  category: { type: String, enum: ONBOARDING_TASK_CATEGORIES, default: 'OTHER' },
  assignee: { type: String, enum: TASK_ASSIGNEE, default: 'HR' },
  dueDate: Date,
  required: { type: Boolean, default: true },
  status: { type: String, enum: TASK_STATUS, default: 'PENDING' },
  note: String,
  completedAt: Date,
  completedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
});

const onboardingSchema = new Schema(
  {
    ...tenantField,
    employeeId: ref('Employee', true),
    templateId: ref('OnboardingTemplate'),
    candidateId: ref('Candidate'),
    startDate: { type: Date, required: true },
    status: { type: String, enum: TASK_STATUS, default: 'PENDING' },
    tasks: { type: [onboardingTaskSchema], default: [] },
    progress: { type: Number, default: 0 },
    completedAt: Date,
    createdBy: ref('User'),
  },
  baseSchemaOptions,
);
onboardingSchema.index({ organizationId: 1, employeeId: 1 });
onboardingSchema.index({ organizationId: 1, status: 1 });
export type Onboarding = InferSchemaType<typeof onboardingSchema>;
export const OnboardingModel = model('Onboarding', onboardingSchema);

const offboardingSchema = new Schema(
  {
    ...tenantField,
    employeeId: ref('Employee', true),
    exitType: { type: String, enum: EXIT_TYPES, required: true },
    reason: { type: String, required: true },
    requestDate: { type: Date, required: true },
    lastWorkingDate: { type: Date, required: true },
    status: { type: String, enum: OFFBOARDING_STATUS, default: 'EXIT_REQUEST' },
    /** Employment status before the exit started (restored on cancellation). */
    previousEmploymentStatus: { type: String, default: 'ACTIVE' },
    clearance: {
      type: [{ _id: false, department: String, cleared: Boolean, note: String, by: Schema.Types.ObjectId, at: Date }],
      default: [],
    },
    assetsReturned: { type: Boolean, default: false },
    finalPayrollId: ref('Payroll'),
    exitInterview: {
      reasonForLeaving: String,
      rating: Number,
      wouldRecommend: Boolean,
      feedback: String,
      conductedAt: Date,
    },
    timeline: {
      type: [{ _id: false, status: String, note: String, by: Schema.Types.ObjectId, at: Date }],
      default: [],
    },
    completedAt: Date,
    createdBy: ref('User'),
  },
  baseSchemaOptions,
);
offboardingSchema.index({ organizationId: 1, employeeId: 1 });
offboardingSchema.index({ organizationId: 1, status: 1 });
export type Offboarding = InferSchemaType<typeof offboardingSchema>;
export const OffboardingModel = model('Offboarding', offboardingSchema);
