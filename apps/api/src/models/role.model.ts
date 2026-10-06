import { Schema, model, type InferSchemaType } from 'mongoose';
import { ALL_PERMISSIONS, SYSTEM_ROLE_KEYS } from '@stencil/shared';
import { baseSchemaOptions, tenantField } from './plugins';

const roleSchema = new Schema(
  {
    ...tenantField,
    name: { type: String, required: true, trim: true, maxlength: 60 },
    key: { type: String, enum: [...SYSTEM_ROLE_KEYS, null], default: null },
    description: { type: String, default: '' },
    permissions: [{ type: String, enum: ALL_PERMISSIONS }],
    isSystem: { type: Boolean, default: false },
  },
  baseSchemaOptions,
);
roleSchema.index({ organizationId: 1, name: 1 }, { unique: true });
roleSchema.index(
  { organizationId: 1, key: 1 },
  { unique: true, partialFilterExpression: { key: { $type: 'string' } } },
);

export type Role = InferSchemaType<typeof roleSchema>;
export const RoleModel = model('Role', roleSchema);

/** Global permission catalog (read-only reference data, synced at startup). */
const permissionSchema = new Schema(
  {
    key: { type: String, required: true, unique: true },
    group: { type: String, required: true },
    groupLabel: { type: String, required: true },
    description: { type: String, required: true },
  },
  { timestamps: false, versionKey: false },
);
export const PermissionModel = model('Permission', permissionSchema);
