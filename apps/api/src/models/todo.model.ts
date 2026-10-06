import { Schema, model, type InferSchemaType } from 'mongoose';
import { ref, tenantField } from './plugins';

/** A personal to-do for one day (only its owner sees it), shown on the dashboard's Todo card. */
const todoSchema = new Schema(
  {
    ...tenantField,
    userId: ref('User', true),
    title: { type: String, required: true, trim: true },
    /** Calendar day, `YYYY-MM-DD` (organization timezone). */
    date: { type: String, required: true },
    done: { type: Boolean, default: false },
    /** Soft colour of the row (see TODO_COLORS). */
    color: { type: String, default: 'gray' },
    /** Position in the day's list (drag to reorder). */
    order: { type: Number, default: 0 },
  },
  { timestamps: true, versionKey: false },
);
todoSchema.index({ organizationId: 1, userId: 1, date: 1, order: 1 });

export type Todo = InferSchemaType<typeof todoSchema>;
export const TodoModel = model('Todo', todoSchema);
