import { Schema, model, type InferSchemaType } from 'mongoose';
import { ref, tenantField } from './plugins';

/**
 * A dated reminder the admin marks on their dashboard calendar. At `remindAt` (the date + time in the
 * organization's timezone; 09:00 when no time is given) the owner gets an in-app + push notification once.
 */
const reminderSchema = new Schema(
  {
    ...tenantField,
    userId: ref('User', true),
    title: { type: String, required: true, trim: true },
    note: String,
    /** `YYYY-MM-DD` (organization timezone). */
    date: { type: String, required: true },
    /** `HH:mm` or null (all day, reminded at 09:00). */
    time: { type: String, default: null },
    color: { type: String, default: 'blue' },
    remindAt: { type: Date, required: true },
    notifiedAt: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false },
);
reminderSchema.index({ organizationId: 1, userId: 1, date: 1 });
reminderSchema.index({ notifiedAt: 1, remindAt: 1 });

export type Reminder = InferSchemaType<typeof reminderSchema>;
export const ReminderModel = model('Reminder', reminderSchema);
