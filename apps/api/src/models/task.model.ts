import { Schema, model, type InferSchemaType } from 'mongoose';
import { WORK_TASK_PRIORITY, WORK_TASK_STATUS } from '@stencil/shared';
import { ref, tenantField } from './plugins';

/**
 * A piece of work a manager, department head or HR assigns to one employee. The assignee is alerted (and sees a
 * pop-up until they open it), moves it to In progress / Done, and the assigner is told when it is finished.
 */
const taskSchema = new Schema(
  {
    ...tenantField,
    title: { type: String, required: true, trim: true },
    description: String,
    priority: { type: String, enum: WORK_TASK_PRIORITY, default: 'MEDIUM' },
    /** Calendar day (00:00 UTC), optional. */
    dueDate: { type: Date, default: null },
    assigneeId: ref('Employee', true),
    assignedBy: ref('User', true),
    assignedByName: String,
    status: { type: String, enum: WORK_TASK_STATUS, default: 'TODO' },
    /** When the assignee first saw it (drives the "new task" pop-up). */
    seenAt: { type: Date, default: null },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    /** Notes along the way (e.g. what was done), newest last. */
    notes: {
      type: [{ _id: false, by: ref('User'), byName: String, text: String, at: { type: Date, default: Date.now } }],
      default: [],
    },
  },
  { timestamps: true, versionKey: false },
);
taskSchema.index({ organizationId: 1, assigneeId: 1, status: 1, createdAt: -1 });
taskSchema.index({ organizationId: 1, assignedBy: 1, status: 1, createdAt: -1 });

export type Task = InferSchemaType<typeof taskSchema>;
export const TaskModel = model('Task', taskSchema);
