import { Schema, model, type InferSchemaType } from 'mongoose';
import { ref, tenantField } from './plugins';

/** One month's sales figure for the organization (imported from an Excel / CSV sheet), for the dashboard graph. */
const salesMonthSchema = new Schema(
  {
    ...tenantField,
    /** `YYYY-MM`. */
    month: { type: String, required: true },
    amount: { type: Number, required: true },
    /** Optional target for the month (from a "Target" column). */
    target: { type: Number, default: null },
    updatedBy: ref('User'),
  },
  { timestamps: true, versionKey: false },
);
salesMonthSchema.index({ organizationId: 1, month: 1 }, { unique: true });

export type SalesMonth = InferSchemaType<typeof salesMonthSchema>;
export const SalesMonthModel = model('SalesMonth', salesMonthSchema);
