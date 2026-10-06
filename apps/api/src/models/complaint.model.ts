import { Schema, model, type InferSchemaType } from 'mongoose';
import { COMPLAINT_CATEGORIES, COMPLAINT_STATUSES } from '@stencil/shared';
import { ref, tenantField } from './plugins';

const replySchema = new Schema(
  {
    userId: ref('User', true),
    name: { type: String, required: true },
    /** From HR / admin (true) or from the person who raised it (false). */
    staff: { type: Boolean, default: false },
    message: { type: String, required: true },
    /** Set when the reply came with a status change. */
    status: { type: String, enum: COMPLAINT_STATUSES, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false }, _id: true },
);

/** A complaint raised by a user; HR / admin (employee:update) review, reply and resolve it. Never anonymous. */
const complaintSchema = new Schema(
  {
    ...tenantField,
    /** CMP-0001, per organization. */
    number: { type: String, required: true },
    raisedBy: ref('User', true),
    employeeId: ref('Employee'),
    raisedByName: { type: String, required: true },
    category: { type: String, enum: COMPLAINT_CATEGORIES, required: true },
    subject: { type: String, required: true, trim: true },
    description: { type: String, required: true },
    status: { type: String, enum: COMPLAINT_STATUSES, default: 'OPEN' },
    replies: { type: [replySchema], default: [] },
    resolvedAt: { type: Date, default: null },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false },
);
complaintSchema.index({ organizationId: 1, raisedBy: 1, createdAt: -1 });
complaintSchema.index({ organizationId: 1, status: 1, createdAt: -1 });

export type Complaint = InferSchemaType<typeof complaintSchema>;
export const ComplaintModel = model('Complaint', complaintSchema);
