import { Schema, type Types } from 'mongoose';

/** Adds the mandatory, indexed tenant key to an organization-owned schema. */
export const tenantField = {
  organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
} as const;

/** Soft delete marker; list queries filter on `deletedAt: null`. */
export const softDeleteField = {
  deletedAt: { type: Date, default: null },
} as const;

export const ref = (model: string, required = false) => ({
  type: Schema.Types.ObjectId,
  ref: model,
  required,
  default: required ? undefined : null,
});

export type Id = Types.ObjectId;

/** Strips internal fields from JSON output. */
export const baseSchemaOptions = {
  timestamps: true,
  toJSON: {
    versionKey: false,
    transform: (_doc: unknown, ret: Record<string, unknown>) => {
      delete ret.passwordHash;
      return ret;
    },
  },
} as const;
