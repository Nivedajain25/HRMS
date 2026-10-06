import { Schema, model, type InferSchemaType } from 'mongoose';
import {
  ANNOUNCEMENT_AUDIENCE,
  ANNOUNCEMENT_PRIORITY,
  ASSET_CATEGORIES,
  ASSET_CONDITIONS,
  ASSET_STATUS,
  DOCUMENT_CATEGORIES,
  DOCUMENT_VERIFICATION,
  EXPENSE_CATEGORIES,
  EXPENSE_STATUS,
} from '@stencil/shared';
import { approvalFields } from './approval.schema';
import { baseSchemaOptions, ref, softDeleteField, tenantField } from './plugins';

/**
 * Stored file metadata. Content lives in the configured StorageProvider and is
 * only ever served through authorized API endpoints (never a public URL).
 */
const documentSchema = new Schema(
  {
    ...tenantField,
    title: { type: String, required: true },
    category: { type: String, enum: DOCUMENT_CATEGORIES, required: true },
    description: String,
    /** Owning employee; null for organization-level documents (policies). */
    employeeId: ref('Employee'),
    /** Where the file is referenced from (expense receipt, resume, announcement...). */
    context: {
      type: String,
      enum: ['EMPLOYEE', 'ORGANIZATION', 'EXPENSE', 'RESUME', 'ANNOUNCEMENT', 'LEAVE', 'REGULARIZATION', 'AVATAR', 'LOGO', 'ATTENDANCE'],
      default: 'EMPLOYEE',
    },
    storageKey: { type: String, required: true },
    originalName: { type: String, required: true },
    mimeType: { type: String, required: true },
    size: { type: Number, required: true },
    checksum: String,
    version: { type: Number, default: 1 },
    /** Root document of a version chain (self for v1). */
    rootDocumentId: ref('Document'),
    isLatest: { type: Boolean, default: true },
    expiryDate: { type: Date, default: null },
    expiryNotifiedAt: { type: Date, default: null },
    confidential: { type: Boolean, default: false },
    verificationStatus: { type: String, enum: DOCUMENT_VERIFICATION, default: 'PENDING' },
    verifiedBy: ref('User'),
    verifiedAt: Date,
    verificationNote: String,
    uploadedBy: ref('User', true),
    ...softDeleteField,
  },
  baseSchemaOptions,
);
documentSchema.index({ organizationId: 1, employeeId: 1, deletedAt: 1, isLatest: 1 });
documentSchema.index({ organizationId: 1, expiryDate: 1 });
documentSchema.index({ organizationId: 1, rootDocumentId: 1, version: -1 });
export type DocumentRecord = InferSchemaType<typeof documentSchema>;
export const DocumentModel = model('Document', documentSchema);

const assetSchema = new Schema(
  {
    ...tenantField,
    assetTag: { type: String, required: true, uppercase: true },
    name: { type: String, required: true },
    category: { type: String, enum: ASSET_CATEGORIES, required: true },
    brand: String,
    model: String,
    serialNumber: String,
    purchaseDate: Date,
    purchaseCost: Number,
    warrantyExpiry: Date,
    vendor: String,
    locationId: ref('Location'),
    status: { type: String, enum: ASSET_STATUS, default: 'AVAILABLE' },
    condition: { type: String, enum: ASSET_CONDITIONS, default: 'NEW' },
    currentAssignmentId: ref('AssetAssignment'),
    currentEmployeeId: ref('Employee'),
    notes: String,
    statusHistory: {
      type: [{ _id: false, from: String, to: String, note: String, by: Schema.Types.ObjectId, at: Date }],
      default: [],
    },
    ...softDeleteField,
  },
  baseSchemaOptions,
);
assetSchema.index({ organizationId: 1, assetTag: 1 }, { unique: true });
assetSchema.index({ organizationId: 1, status: 1, category: 1 });
assetSchema.index({ organizationId: 1, serialNumber: 1 });
export type Asset = InferSchemaType<typeof assetSchema>;
export const AssetModel = model('Asset', assetSchema);

const assetAssignmentSchema = new Schema(
  {
    ...tenantField,
    assetId: ref('Asset', true),
    employeeId: ref('Employee', true),
    assignedDate: { type: Date, required: true },
    expectedReturnDate: Date,
    returnedDate: { type: Date, default: null },
    conditionAtAssignment: { type: String, enum: ASSET_CONDITIONS },
    conditionAtReturn: { type: String, enum: [...ASSET_CONDITIONS, null], default: null },
    notes: String,
    returnNotes: String,
    status: { type: String, enum: ['ACTIVE', 'RETURNED'], default: 'ACTIVE' },
    assignedBy: ref('User'),
    returnedTo: ref('User'),
  },
  baseSchemaOptions,
);
assetAssignmentSchema.index({ organizationId: 1, employeeId: 1, status: 1 });
assetAssignmentSchema.index({ organizationId: 1, assetId: 1, assignedDate: -1 });
export type AssetAssignment = InferSchemaType<typeof assetAssignmentSchema>;
export const AssetAssignmentModel = model('AssetAssignment', assetAssignmentSchema);

const expenseSchema = new Schema(
  {
    ...tenantField,
    expenseNumber: { type: String, required: true },
    employeeId: ref('Employee', true),
    category: { type: String, enum: EXPENSE_CATEGORIES, required: true },
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, required: true },
    date: { type: Date, required: true },
    description: { type: String, required: true },
    merchant: String,
    project: String,
    receiptFileId: ref('Document'),
    status: { type: String, enum: EXPENSE_STATUS, default: 'DRAFT' },
    ...approvalFields,
    rejectionReason: String,
    submittedAt: Date,
    approvedAt: Date,
    paidAt: Date,
    paidBy: ref('User'),
    paymentReference: String,
    createdBy: ref('User'),
  },
  baseSchemaOptions,
);
expenseSchema.index({ organizationId: 1, expenseNumber: 1 }, { unique: true });
expenseSchema.index({ organizationId: 1, employeeId: 1, status: 1 });
expenseSchema.index({ organizationId: 1, status: 1, date: -1 });
export type Expense = InferSchemaType<typeof expenseSchema>;
export const ExpenseModel = model('Expense', expenseSchema);

const announcementSchema = new Schema(
  {
    ...tenantField,
    title: { type: String, required: true },
    /** Sanitized HTML (see utils/sanitize-html.ts). */
    content: { type: String, required: true },
    priority: { type: String, enum: ANNOUNCEMENT_PRIORITY, default: 'NORMAL' },
    audience: { type: String, enum: ANNOUNCEMENT_AUDIENCE, default: 'ALL' },
    departmentIds: [{ type: Schema.Types.ObjectId, ref: 'Department' }],
    employeeIds: [{ type: Schema.Types.ObjectId, ref: 'Employee' }],
    attachmentIds: [{ type: Schema.Types.ObjectId, ref: 'Document' }],
    publishAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, default: null },
    pinned: { type: Boolean, default: false },
    sendEmail: { type: Boolean, default: false },
    notifiedAt: { type: Date, default: null },
    createdBy: ref('User', true),
    ...softDeleteField,
  },
  baseSchemaOptions,
);
announcementSchema.index({ organizationId: 1, publishAt: -1 });
// Scheduled-publish sweep (due, not yet notified) and title search.
announcementSchema.index({ notifiedAt: 1, publishAt: 1 });
announcementSchema.index({ organizationId: 1, title: 1 });
export type Announcement = InferSchemaType<typeof announcementSchema>;
export const AnnouncementModel = model('Announcement', announcementSchema);

const announcementReadSchema = new Schema(
  {
    ...tenantField,
    announcementId: ref('Announcement', true),
    userId: ref('User', true),
    readAt: { type: Date, default: Date.now },
  },
  { versionKey: false },
);
announcementReadSchema.index({ announcementId: 1, userId: 1 }, { unique: true });
export const AnnouncementReadModel = model('AnnouncementRead', announcementReadSchema);
