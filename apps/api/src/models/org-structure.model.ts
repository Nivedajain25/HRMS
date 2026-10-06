import { Schema, model, type InferSchemaType } from 'mongoose';
import { ENTITY_STATUS, LOCATION_TYPES } from '@stencil/shared';
import { baseSchemaOptions, ref, softDeleteField, tenantField } from './plugins';

const departmentSchema = new Schema(
  {
    ...tenantField,
    name: { type: String, required: true, trim: true },
    code: { type: String, required: true, uppercase: true, trim: true },
    description: String,
    headId: ref('Employee'),
    parentId: ref('Department'),
    status: { type: String, enum: ENTITY_STATUS, default: 'ACTIVE' },
    ...softDeleteField,
  },
  baseSchemaOptions,
);
departmentSchema.index({ organizationId: 1, code: 1 }, { unique: true });
departmentSchema.index({ organizationId: 1, name: 1 });
export type Department = InferSchemaType<typeof departmentSchema>;
export const DepartmentModel = model('Department', departmentSchema);

const designationSchema = new Schema(
  {
    ...tenantField,
    name: { type: String, required: true, trim: true },
    code: { type: String, required: true, uppercase: true, trim: true },
    level: { type: Number, default: 1, min: 1 },
    departmentId: ref('Department'),
    description: String,
    status: { type: String, enum: ENTITY_STATUS, default: 'ACTIVE' },
    ...softDeleteField,
  },
  baseSchemaOptions,
);
designationSchema.index({ organizationId: 1, code: 1 }, { unique: true });
designationSchema.index({ organizationId: 1, name: 1 });
export type Designation = InferSchemaType<typeof designationSchema>;
export const DesignationModel = model('Designation', designationSchema);

const locationSchema = new Schema(
  {
    ...tenantField,
    name: { type: String, required: true, trim: true },
    type: { type: String, enum: LOCATION_TYPES, default: 'OFFICE' },
    address: String,
    city: String,
    state: String,
    country: String,
    postalCode: String,
    timezone: String,
    latitude: Number,
    longitude: Number,
    geofenceRadiusMeters: { type: Number, default: 0 },
    status: { type: String, enum: ENTITY_STATUS, default: 'ACTIVE' },
    ...softDeleteField,
  },
  baseSchemaOptions,
);
locationSchema.index({ organizationId: 1, name: 1 }, { unique: true });
export type Location = InferSchemaType<typeof locationSchema>;
export const LocationModel = model('Location', locationSchema);
