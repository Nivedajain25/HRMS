import { z } from 'zod';
import {
  ANNOUNCEMENT_AUDIENCE,
  ANNOUNCEMENT_PRIORITY,
  ASSET_CATEGORIES,
  ASSET_CONDITIONS,
  DOCUMENT_CATEGORIES,
  EMERGENCY_CATEGORIES,
  EMERGENCY_STATUS,
  EXPENSE_CATEGORIES,
  NOTIFICATION_TYPES,
  WORK_TASK_PRIORITY,
  WORK_TASK_STATUS,
} from '../enums';
import {
  dateString,
  money,
  nullableDateString,
  nullableObjectId,
  objectId,
  optionalDateString,
  optionalObjectId,
  optionalString,
  patchSchema,
  requiredString,
} from './common';

/* ----------------------------- Documents ---------------------------- */

/** Multipart form fields accompanying a document upload. */
export const documentUploadSchema = z.object({
  title: requiredString('Title', 150),
  category: z.enum(DOCUMENT_CATEGORIES),
  employeeId: optionalObjectId,
  description: optionalString(500),
  expiryDate: optionalDateString,
  /** Upload as a new version of an existing document. */
  parentDocumentId: optionalObjectId,
  confidential: z.preprocess((v) => v === true || v === 'true', z.boolean()).default(false),
});
export type DocumentUploadInput = z.input<typeof documentUploadSchema>;

export const documentVerifySchema = z.object({
  status: z.enum(['VERIFIED', 'REJECTED']),
  note: optionalString(500),
});

/** Where a generic upload (`POST /files`) will be referenced from. */
export const FILE_CONTEXTS = [
  'EXPENSE',
  'RESUME',
  'ANNOUNCEMENT',
  'LEAVE',
  'REGULARIZATION',
  'AVATAR',
  'LOGO',
  /** Clock-in / clock-out selfie (images only, visible to the owner, their managers and HR). */
  'ATTENDANCE',
] as const;
export type FileContext = (typeof FILE_CONTEXTS)[number];

/** Multipart fields for a generic attachment upload. */
export const fileUploadSchema = z.object({
  context: z.preprocess((v) => (v === '' ? undefined : v), z.enum(FILE_CONTEXTS).optional()),
  category: z.preprocess((v) => (v === '' ? undefined : v), z.enum(DOCUMENT_CATEGORIES).optional()),
  title: optionalString(150),
});
export type FileUploadInput = z.input<typeof fileUploadSchema>;

/* ------------------------------ Assets ------------------------------ */

export const assetSchema = z.object({
  assetTag: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9-]{1,24}$/, 'Letters, digits and dashes only')
    .optional(),
  name: requiredString('Name', 150),
  category: z.enum(ASSET_CATEGORIES),
  brand: optionalString(80),
  model: optionalString(80),
  serialNumber: optionalString(80),
  purchaseDate: optionalDateString,
  purchaseCost: money.optional(),
  warrantyExpiry: optionalDateString,
  vendor: optionalString(120),
  locationId: nullableObjectId,
  condition: z.enum(ASSET_CONDITIONS).default('NEW'),
  notes: optionalString(1000),
});
export type AssetInput = z.input<typeof assetSchema>;
/**
 * Update body: omitted fields stay unchanged (no defaults applied); `null`
 * clears an optional field. The asset tag can be changed but never cleared.
 */
export const assetUpdateSchema = patchSchema(assetSchema).extend({ assetTag: assetSchema.shape.assetTag });

export const assetAssignSchema = z.object({
  employeeId: objectId,
  assignedDate: dateString,
  expectedReturnDate: optionalDateString,
  condition: z.enum(ASSET_CONDITIONS).default('GOOD'),
  notes: optionalString(500),
});
export const assetReturnSchema = z.object({
  returnedDate: dateString,
  condition: z.enum(ASSET_CONDITIONS),
  notes: optionalString(500),
});
export const assetStatusSchema = z.object({
  status: z.enum(['AVAILABLE', 'REPAIR', 'RETIRED']),
  notes: optionalString(500),
});

/* ----------------------------- Expenses ----------------------------- */

export const expenseSchema = z.object({
  category: z.enum(EXPENSE_CATEGORIES),
  amount: money.refine((v) => v > 0, 'Amount must be positive'),
  currency: z.string().length(3).toUpperCase(),
  date: dateString,
  description: requiredString('Description', 1000),
  merchant: optionalString(120),
  project: optionalString(120),
  receiptFileId: optionalObjectId,
  employeeId: optionalObjectId,
  submit: z.boolean().default(true),
});
export type ExpenseInput = z.input<typeof expenseSchema>;
/** Draft update body (owner only): omitted fields stay unchanged. */
export const expenseUpdateSchema = patchSchema(expenseSchema.omit({ employeeId: true, submit: true }));

export const expensePaySchema = z.object({
  paymentReference: optionalString(100),
  paidDate: dateString,
});

/* --------------------------- Announcements -------------------------- */

/** Base object (no refinements) so PATCH schemas can be derived with `patchSchema`. */
export const announcementBaseSchema = z.object({
  title: requiredString('Title', 200),
  content: requiredString('Content', 20000),
  priority: z.enum(ANNOUNCEMENT_PRIORITY).default('NORMAL'),
  audience: z.enum(ANNOUNCEMENT_AUDIENCE).default('ALL'),
  departmentIds: z.array(objectId).max(100).default([]),
  employeeIds: z.array(objectId).max(1000).default([]),
  attachmentIds: z.array(objectId).max(10).default([]),
  publishAt: z.iso.datetime({ offset: true }).optional(),
  /** `null` clears the expiry on update. */
  expiresAt: z.iso.datetime({ offset: true }).nullable().optional(),
  pinned: z.boolean().default(false),
  sendEmail: z.boolean().default(false),
});

/** Update body: every field optional, no defaults (omitted fields stay unchanged). */
export const announcementUpdateSchema = patchSchema(announcementBaseSchema).extend({
  /** The publish date can be moved but not cleared. */
  publishAt: announcementBaseSchema.shape.publishAt,
});
export type AnnouncementUpdateInput = z.output<typeof announcementUpdateSchema>;

export const announcementListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(100).optional(),
  /** `all` (requires announcement:manage) includes scheduled and expired announcements. */
  scope: z.enum(['mine', 'all']).optional(),
  priority: z.enum(ANNOUNCEMENT_PRIORITY).optional(),
});
export type AnnouncementListQuery = z.output<typeof announcementListQuery>;

export const announcementSchema = announcementBaseSchema
  .refine((d) => d.audience !== 'DEPARTMENTS' || d.departmentIds.length > 0, {
    message: 'Select at least one department',
    path: ['departmentIds'],
  })
  .refine((d) => d.audience !== 'EMPLOYEES' || d.employeeIds.length > 0, {
    message: 'Select at least one employee',
    path: ['employeeIds'],
  });
export type AnnouncementInput = z.input<typeof announcementSchema>;

/* --------------------------- Notifications -------------------------- */

export const notificationListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  unread: z.preprocess((v) => v === true || v === 'true' || v === '1', z.boolean()).optional(),
  /** Only the ones the user starred (kept). */
  starred: z.preprocess((v) => v === true || v === 'true' || v === '1', z.boolean()).optional(),
});
export type NotificationListQuery = z.output<typeof notificationListQuery>;

/** Star (keep) or unstar one of your own notifications. */
export const notificationStarSchema = z.object({ starred: z.boolean() });

export const notificationPreferencesSchema = z.object({
  preferences: z
    .array(
      z.object({
        type: z.enum(NOTIFICATION_TYPES),
        inApp: z.boolean(),
        email: z.boolean(),
      }),
    )
    .max(50),
});

/* ------------------------------ Reports ----------------------------- */

export const REPORT_TYPES = [
  'employees',
  'attendance',
  'attendance_log',
  'leave',
  'payroll',
  'expenses',
  'recruitment',
  'performance',
  'assets',
] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

export const reportQuerySchema = z.object({
  from: optionalDateString,
  to: optionalDateString,
  departmentId: nullableObjectId,
  status: z.string().max(40).optional(),
  format: z.enum(['json', 'csv', 'xlsx', 'pdf']).default('json'),
  /** JSON only: rows are paginated (max 5000 per page). File exports include every row. */
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(5000).default(5000),
});
export type ReportQuery = z.input<typeof reportQuerySchema>;
export type ReportQueryOutput = z.output<typeof reportQuerySchema>;

/* ---------------------------- Emergencies --------------------------- */

/** An employee raising an emergency: HR and their manager are alerted immediately. */
export const emergencyRaiseSchema = z.object({
  category: z.enum(EMERGENCY_CATEGORIES),
  message: optionalString(1000),
  /** They have to leave work right away (e.g. go home). */
  needToLeave: z.boolean().default(true),
  /** Number HR can call back on (defaults to the employee's phone on file). */
  contactPhone: optionalString(30),
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
  accuracy: z.coerce.number().min(0).max(100000).optional(),
});
export type EmergencyRaiseInput = z.input<typeof emergencyRaiseSchema>;

export const emergencyListQuery = z.object({
  status: z.enum(EMERGENCY_STATUS).optional(),
  /** `mine`: only the caller's own alerts (default for employees without `emergency:manage`). */
  scope: z.enum(['mine', 'all']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

/* ----------------------------- Reminders ---------------------------- */

export const REMINDER_COLORS = ['blue', 'red', 'green', 'amber', 'purple'] as const;
export const reminderListQuery = z.object({ from: dateString, to: dateString });
export const reminderSchema = z.object({
  title: requiredString('Reminder', 150),
  note: optionalString(1000),
  date: dateString,
  /** `HH:mm`; empty = all day (reminded at 09:00). */
  time: z.preprocess((v) => (v === '' ? null : v), z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:mm').nullable().optional()),
  color: z.enum(REMINDER_COLORS).optional(),
});
export const reminderUpdateSchema = reminderSchema.partial();

/* ------------------------------- Todos ------------------------------ */

/** Row colours for personal to-dos. */
export const TODO_COLORS = ['gray', 'orange', 'red', 'purple', 'blue', 'yellow', 'green'] as const;

/* ----------------------------- Individual sales ----------------------------- */

/** One sale an employee records for themselves. */
export const saleEntrySchema = z.object({
  date: dateString,
  customer: requiredString('Customer', 150),
  amount: z.coerce.number().positive('Amount must be more than 0').max(1e12),
  note: optionalString(500),
});
export const saleEntryUpdateSchema = saleEntrySchema.partial();
/** `scope=all` (report:read or employee:read): everyone's sales; otherwise only mine. */
export const saleEntryListQuery = z.object({
  scope: z.enum(['me', 'all']).optional(),
  employeeId: z.string().regex(/^[a-f\d]{24}$/i).optional(),
  from: optionalDateString,
  to: optionalDateString,
  search: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(500).default(50),
});
const monthKey = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM');
/** HR / admin set (or clear, with amount 0) an employee's sales target for a month. */
export const salesTargetSchema = z.object({
  employeeId: z.string().regex(/^[a-f\d]{24}$/i),
  month: monthKey,
  amount: z.coerce.number().min(0).max(1e12),
});
export const salesTargetQuery = z.object({ month: monthKey });

export const MEETING_TYPES = ['OFFICE_VISIT', 'SITE_VISIT', 'SHOWROOM_VISIT', 'CALL', 'VIDEO_CALL', 'EVENT'] as const;
export const MEETING_OUTCOMES = ['INTERESTED', 'QUOTATION_REQUESTED', 'SAMPLE_REQUESTED', 'FOLLOW_UP', 'ORDER_EXPECTED', 'NOT_INTERESTED'] as const;

export const architectMeetingSchema = z.object({
  date: dateString,
  architectName: requiredString('Architect name', 150),
  firm: optionalString(150),
  phone: optionalString(30),
  email: z.union([z.literal(''), z.string().trim().email('Enter a valid email').max(150)]).optional(),
  meetingType: z.preprocess((v) => (v === '' ? null : v), z.enum(MEETING_TYPES).nullable().optional()),
  projectName: optionalString(200),
  location: optionalString(200),
  productsDiscussed: optionalString(500),
  outcome: z.preprocess((v) => (v === '' ? null : v), z.enum(MEETING_OUTCOMES).nullable().optional()),
  followUpDate: nullableDateString,
  /** Detailed description of the meeting. */
  notes: optionalString(3000),
});
export const architectMeetingUpdateSchema = architectMeetingSchema.partial();
export const architectMeetingListQuery = z.object({
  scope: z.enum(['me', 'all']).optional(),
  employeeId: z.string().regex(/^[a-f\d]{24}$/i).optional(),
  from: optionalDateString,
  to: optionalDateString,
  search: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(500).default(50),
});

export const saleSummaryQuery = z.object({
  scope: z.enum(['me', 'all']).optional(),
  employeeId: z.string().regex(/^[a-f\d]{24}$/i).optional(),
  from: optionalDateString,
  to: optionalDateString,
  /** Months for the monthly series, ending this month (default 12). */
  months: z.coerce.number().int().min(1).max(36).optional(),
});

export const todoListQuery = z.object({ date: dateString });

/* ----------------------------- Complaints ----------------------------- */

export const COMPLAINT_CATEGORIES = ['WORKPLACE', 'HARASSMENT', 'PAYROLL', 'MANAGER', 'FACILITIES', 'IT', 'OTHER'] as const;
export const COMPLAINT_STATUSES = ['OPEN', 'IN_REVIEW', 'RESOLVED', 'CLOSED'] as const;
export type ComplaintCategory = (typeof COMPLAINT_CATEGORIES)[number];
export type ComplaintStatus = (typeof COMPLAINT_STATUSES)[number];

export const complaintSchema = z.object({
  category: z.enum(COMPLAINT_CATEGORIES),
  subject: requiredString('Subject', 150),
  description: requiredString('Details', 5000),
});
export const complaintReplySchema = z.object({ message: requiredString('Message', 3000) });
export const complaintStatusSchema = z.object({ status: z.enum(COMPLAINT_STATUSES), message: optionalString(3000) });
export const complaintListQuery = z.object({
  scope: z.enum(['me', 'all']).optional(),
  status: z.enum(COMPLAINT_STATUSES).optional(),
  search: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export const todoCreateSchema = z.object({
  title: requiredString('To-do', 200),
  date: dateString,
  color: z.enum(TODO_COLORS).optional(),
});
export const todoUpdateSchema = z.object({
  title: requiredString('To-do', 200).optional(),
  done: z.boolean().optional(),
  color: z.enum(TODO_COLORS).optional(),
});
/** New order of one day's to-dos (ids top to bottom). */
export const todoReorderSchema = z.object({ ids: z.array(objectId).max(200) });

/* ------------------------------- Tasks ------------------------------ */

/** A manager / department head / HR assigns a task to one or more employees (one task each). */
export const taskCreateSchema = z.object({
  title: requiredString('Title', 150),
  description: optionalString(2000),
  assigneeIds: z.array(objectId).min(1, 'Choose at least one person').max(50),
  priority: z.enum(WORK_TASK_PRIORITY).default('MEDIUM'),
  dueDate: optionalDateString,
});
export type TaskCreateInput = z.input<typeof taskCreateSchema>;

export const taskListQuery = z.object({
  /** `mine`: tasks assigned to me; `assigned`: tasks I assigned to others. */
  scope: z.enum(['mine', 'assigned']).default('mine'),
  /** `open` = TODO + IN_PROGRESS; `done` = finished. */
  state: z.enum(['open', 'done']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

/** Assignee moves a task along (or the assigner reopens it), with an optional note. */
export const taskStatusUpdateSchema = z.object({
  status: z.enum(WORK_TASK_STATUS),
  note: optionalString(1000),
});

/** HR response: acknowledge (someone is on it) or resolve, with an optional note. */
export const emergencyUpdateSchema = z.object({
  status: z.enum(['ACKNOWLEDGED', 'RESOLVED']),
  note: optionalString(1000),
});

export const EMERGENCY_DECISIONS = ['APPROVED', 'DECLINED'] as const;
export type EmergencyDecision = (typeof EMERGENCY_DECISIONS)[number];

/** HR / super admin decides a "need to leave" emergency: approve (they may go) or decline; this closes the alert. */
export const emergencyDecisionSchema = z.object({
  decision: z.enum(EMERGENCY_DECISIONS),
  note: optionalString(1000),
});
