import { Schema, model, type InferSchemaType } from 'mongoose';
import {
  CANDIDATE_SOURCES,
  CANDIDATE_STAGES,
  EMPLOYMENT_TYPES,
  INTERVIEW_STATUS,
  INTERVIEW_TYPES,
  JOB_STATUS,
} from '@stencil/shared';
import { baseSchemaOptions, ref, softDeleteField, tenantField } from './plugins';

const jobOpeningSchema = new Schema(
  {
    ...tenantField,
    code: { type: String, required: true },
    title: { type: String, required: true },
    departmentId: ref('Department'),
    designationId: ref('Designation'),
    locationId: ref('Location'),
    employmentType: { type: String, enum: EMPLOYMENT_TYPES, default: 'FULL_TIME' },
    openings: { type: Number, default: 1 },
    filled: { type: Number, default: 0 },
    experienceMin: { type: Number, default: 0 },
    experienceMax: { type: Number, default: 0 },
    salaryMin: { type: Number, default: 0 },
    salaryMax: { type: Number, default: 0 },
    currency: String,
    skills: [String],
    description: { type: String, required: true },
    requirements: String,
    status: { type: String, enum: JOB_STATUS, default: 'DRAFT' },
    hiringManagerId: ref('Employee'),
    closingDate: Date,
    publishedAt: Date,
    createdBy: ref('User'),
    ...softDeleteField,
  },
  baseSchemaOptions,
);
jobOpeningSchema.index({ organizationId: 1, code: 1 }, { unique: true });
jobOpeningSchema.index({ organizationId: 1, status: 1 });
jobOpeningSchema.index({ title: 'text', description: 'text' });
export type JobOpening = InferSchemaType<typeof jobOpeningSchema>;
export const JobOpeningModel = model('JobOpening', jobOpeningSchema);

const candidateSchema = new Schema(
  {
    ...tenantField,
    jobId: ref('JobOpening', true),
    firstName: { type: String, required: true },
    lastName: { type: String, required: true },
    email: { type: String, required: true, lowercase: true },
    phone: String,
    resumeFileId: ref('Document'),
    skills: [String],
    experienceYears: { type: Number, default: 0 },
    currentCompany: String,
    currentSalary: Number,
    expectedSalary: Number,
    noticePeriodDays: Number,
    source: { type: String, enum: CANDIDATE_SOURCES, default: 'CAREERS_PAGE' },
    stage: { type: String, enum: CANDIDATE_STAGES, default: 'APPLIED' },
    stageHistory: {
      type: [{ _id: false, from: String, to: String, note: String, by: Schema.Types.ObjectId, at: Date }],
      default: [],
    },
    rating: Number,
    notes: String,
    rejectionReason: String,
    hiredEmployeeId: ref('Employee'),
    hiredAt: Date,
    /** Set while a hire is in progress (guards against concurrent double hires). */
    hiringStartedAt: { type: Date, default: null },
    createdBy: ref('User'),
    ...softDeleteField,
  },
  baseSchemaOptions,
);
candidateSchema.index({ organizationId: 1, jobId: 1, email: 1 }, { unique: true });
candidateSchema.index({ organizationId: 1, stage: 1 });
export type Candidate = InferSchemaType<typeof candidateSchema>;
export const CandidateModel = model('Candidate', candidateSchema);

const interviewSchema = new Schema(
  {
    ...tenantField,
    candidateId: ref('Candidate', true),
    jobId: ref('JobOpening', true),
    interviewerIds: [{ type: Schema.Types.ObjectId, ref: 'Employee' }],
    scheduledAt: { type: Date, required: true },
    durationMinutes: { type: Number, default: 60 },
    type: { type: String, enum: INTERVIEW_TYPES, default: 'VIDEO' },
    round: { type: Number, default: 1 },
    meetingLink: String,
    location: String,
    notes: String,
    status: { type: String, enum: INTERVIEW_STATUS, default: 'SCHEDULED' },
    cancellationReason: String,
    feedback: {
      type: [
        {
          _id: false,
          interviewerId: Schema.Types.ObjectId,
          interviewerName: String,
          rating: Number,
          feedback: String,
          recommendation: String,
          at: Date,
        },
      ],
      default: [],
    },
    rating: Number,
    rescheduleCount: { type: Number, default: 0 },
    createdBy: ref('User'),
  },
  baseSchemaOptions,
);
interviewSchema.index({ organizationId: 1, scheduledAt: 1 });
interviewSchema.index({ organizationId: 1, candidateId: 1 });
interviewSchema.index({ organizationId: 1, interviewerIds: 1, status: 1, scheduledAt: 1 });
export type Interview = InferSchemaType<typeof interviewSchema>;
export const InterviewModel = model('Interview', interviewSchema);
