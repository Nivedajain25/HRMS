import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { USER_STATUS } from '@stencil/shared';
import { baseSchemaOptions, ref, tenantField } from './plugins';

const userSchema = new Schema(
  {
    ...tenantField,
    employeeId: ref('Employee'),
    email: { type: String, required: true, lowercase: true, trim: true },
    passwordHash: { type: String, select: false, default: null },
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, trim: true, default: '' },
    avatar: { type: String, default: null },
    roles: [{ type: Schema.Types.ObjectId, ref: 'Role' }],
    status: { type: String, enum: USER_STATUS, default: 'ACTIVE' },
    emailVerified: { type: Boolean, default: false },
    lastLoginAt: { type: Date, default: null },
    failedLoginAttempts: { type: Number, default: 0 },
    lockedUntil: { type: Date, default: null },
    passwordChangedAt: { type: Date, default: null },
    /** Incremented to invalidate every issued access token (logout-all / deactivation). */
    tokenVersion: { type: Number, default: 0 },
    preferences: {
      theme: { type: String, enum: ['light', 'dark', 'system'], default: 'system' },
      language: { type: String, default: 'en' },
    },
  },
  baseSchemaOptions,
);

// Email is globally unique so login needs no organization selector.
userSchema.index({ email: 1 }, { unique: true });
userSchema.index({ organizationId: 1, status: 1 });
userSchema.index({ organizationId: 1, employeeId: 1 });

export type User = InferSchemaType<typeof userSchema>;
export type UserDoc = HydratedDocument<User>;
export const UserModel = model('User', userSchema);
