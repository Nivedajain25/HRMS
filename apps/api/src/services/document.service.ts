import crypto from 'node:crypto';
import type { Readable } from 'node:stream';
import { Types, type FilterQuery } from 'mongoose';
import type { z } from 'zod';
import type { FileContext, PaginationQuery, documentUploadSchema, documentVerifySchema, fileUploadSchema } from '@stencil/shared';
import { logger } from '../config/logger';
import { defineScheduledJob } from '../jobs';
import { DOCUMENT_MIME_TYPES, IMAGE_MIME_TYPES, detectAndValidateMime } from '../middleware/upload';
import {
  CandidateModel,
  DocumentModel,
  EmployeeModel,
  ExpenseModel,
  InterviewModel,
  JobOpeningModel,
  OrganizationModel,
  UserModel,
  type DocumentRecord,
} from '../models';
import { storage } from '../storage/storage.service';
import { can, type RequestContext } from '../types/context';
import { addDaysKey, dateOnly, toDateKey, todayKey } from '../utils/dates';
import { badRequest, forbidden, notFound } from '../utils/errors';
import { buildSort, paginate, searchFilter } from '../utils/pagination';
import { withTransaction } from '../utils/transaction';
import { audit } from './audit.service';
import { sendEmail } from './email.service';
import { setProfilePhoto } from './employee.service';
import { notify, notifyHr, userIdsForEmployees, userIdsWithPermission } from './notification.service';
import { assertRefsInOrg } from './refs.service';
import { assertEmployeeAccess, isManagerOf, resolveEmployeeScope } from './scope.service';

type UploadedFile = Express.Multer.File | undefined;
type DocumentUpload = z.output<typeof documentUploadSchema>;
type DocumentVerify = z.output<typeof documentVerifySchema>;
type FileUpload = z.output<typeof fileUploadSchema>;
type DocContext = DocumentRecord['context'];
type LeanDocument = DocumentRecord & { _id: Types.ObjectId; createdAt?: Date };

/** Contexts managed through the employee/organization documents module. */
const LIBRARY_CONTEXTS = ['EMPLOYEE', 'ORGANIZATION'] as const;
/** Upload contexts whose files belong to the uploader's own employee record. */
const PERSONAL_CONTEXTS = new Set<FileContext>(['EXPENSE', 'LEAVE', 'REGULARIZATION', 'AVATAR', 'ATTENDANCE']);
/** Upload contexts that accept images only. */
const IMAGE_CONTEXTS = new Set<FileContext>(['AVATAR', 'LOGO', 'ATTENDANCE']);
/** Files readable by anyone in the organization. */
const ORG_VISIBLE_CONTEXTS = new Set<string>(['AVATAR', 'ANNOUNCEMENT', 'LOGO']);
/** Formats that browsers render safely inline (previews). */
const INLINE_MIME_TYPES = new Set<string>(['application/pdf', ...IMAGE_MIME_TYPES]);
const OWNER_DELETE_WINDOW_MS = 24 * 60 * 60 * 1000;
const PUBLIC_SELECT = '-storageKey';

/* ------------------------------- Storage ------------------------------ */

interface StoredFile {
  storageKey: string;
  originalName: string;
  mimeType: string;
  size: number;
  checksum: string;
}

/** Multer decodes filenames as latin1; recover UTF-8 names without mangling real latin1. */
const decodeName = (name: string) => {
  // Any code point above latin1 means the name is already proper Unicode.
  // eslint-disable-next-line no-control-regex
  if (/[^\u0000-ÿ]/.test(name)) return name;
  const utf8 = Buffer.from(name, 'latin1').toString('utf8');
  return utf8.includes('�') ? name : utf8;
};

/**
 * Validates the real content type and writes the file under an opaque key
 * (`org/yyyy/mm/random.ext`); the client's file name never reaches storage.
 */
const putFile = async (ctx: RequestContext, file: UploadedFile, allowed: readonly string[]): Promise<StoredFile> => {
  if (!file) throw badRequest('A file is required', 'FILE_REQUIRED');
  const detected = await detectAndValidateMime(file, allowed);
  const now = new Date();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const storageKey = `${String(ctx.organizationId)}/${now.getUTCFullYear()}/${month}/${crypto.randomBytes(16).toString('hex')}.${detected.ext}`;
  await storage().put(storageKey, file.buffer, detected.mime);
  return {
    storageKey,
    originalName: decodeName(file.originalname || `file.${detected.ext}`).slice(0, 255),
    mimeType: detected.mime,
    size: file.size,
    checksum: crypto.createHash('sha256').update(file.buffer).digest('hex'),
  };
};

/** Removes an orphaned object when the metadata write fails. */
const discard = async (key: string) => {
  try {
    await storage().delete(key);
  } catch (err) {
    logger.warn({ err, key }, 'Failed to remove orphaned upload');
  }
};

const toPublic = (doc: { toObject: () => Record<string, unknown> }) => {
  const { storageKey: _key, ...rest } = doc.toObject();
  void _key;
  return { ...rest, url: `/api/v1/files/${String(rest._id)}` };
};

/* ---------------------------- Authorization --------------------------- */

const isOwnEmployee = (ctx: RequestContext, employeeId: Types.ObjectId | null | undefined) =>
  !!employeeId && !!ctx.employeeId?.equals(employeeId);

const managesEmployee = async (ctx: RequestContext, employeeId: Types.ObjectId | null | undefined) =>
  !!employeeId && can(ctx, 'team:view') && (await isManagerOf(ctx, employeeId));

/**
 * Hiring managers of the job and assigned interviewers of a candidate may read
 * that candidate's resume.
 */
const isResumeParticipant = async (ctx: RequestContext, docId: Types.ObjectId): Promise<boolean> => {
  if (!ctx.employeeId) return false;
  const candidates = await CandidateModel.find({ organizationId: ctx.organizationId, resumeFileId: docId })
    .select('_id jobId')
    .lean();
  if (!candidates.length) return false;
  const jobIds = candidates.map((c) => c.jobId).filter(Boolean);
  const managed = await JobOpeningModel.exists({
    organizationId: ctx.organizationId,
    _id: { $in: jobIds },
    hiringManagerId: ctx.employeeId,
  });
  if (managed) return true;
  const interviewing = await InterviewModel.exists({
    organizationId: ctx.organizationId,
    candidateId: { $in: candidates.map((c) => c._id) },
    interviewerIds: ctx.employeeId,
  });
  return !!interviewing;
};

/**
 * Read rules for a stored file (tenant scoping is applied by the caller's query).
 * Uploaders and owners can always read; others depend on where the file is used.
 */
export const canReadDocument = async (ctx: RequestContext, doc: LeanDocument): Promise<boolean> => {
  if (doc.uploadedBy && ctx.userId.equals(doc.uploadedBy)) return true;
  const own = isOwnEmployee(ctx, doc.employeeId);
  const context: DocContext = doc.context ?? 'EMPLOYEE';
  if (ORG_VISIBLE_CONTEXTS.has(context)) return true;

  switch (context) {
    case 'ORGANIZATION':
      return !doc.confidential || can(ctx, 'document:read');
    case 'RESUME':
      return can(ctx, 'recruitment:read') || (await isResumeParticipant(ctx, doc._id));
    case 'EXPENSE': {
      if (own || can(ctx, 'expense:read') || can(ctx, 'expense:pay')) return true;
      // Approvers of the expense(s) this receipt is attached to.
      const expenses = await ExpenseModel.find({ organizationId: ctx.organizationId, receiptFileId: doc._id }).select('employeeId').lean();
      for (const e of expenses) {
        if (isOwnEmployee(ctx, e.employeeId)) return true;
        if (can(ctx, 'expense:approve') && e.employeeId && (await isManagerOf(ctx, e.employeeId))) return true;
      }
      return managesEmployee(ctx, doc.employeeId);
    }
    case 'LEAVE':
      return own || can(ctx, 'leave:read') || can(ctx, 'document:read') || (await managesEmployee(ctx, doc.employeeId));
    case 'REGULARIZATION':
      return own || can(ctx, 'attendance:read') || can(ctx, 'document:read') || (await managesEmployee(ctx, doc.employeeId));
    case 'ATTENDANCE':
      // Clock-in selfies: the employee, their manager chain and attendance administrators only.
      return own || can(ctx, 'attendance:read') || (await managesEmployee(ctx, doc.employeeId));
    default:
      if (own || can(ctx, 'document:read')) return true;
      return !doc.confidential && (await managesEmployee(ctx, doc.employeeId));
  }
};

/** Upload rights for the documents library: own documents, or `document:create` for others / org-level. */
const assertCanWrite = async (ctx: RequestContext, employeeId: Types.ObjectId | null) => {
  if (employeeId && isOwnEmployee(ctx, employeeId)) return;
  if (!can(ctx, 'document:create')) {
    throw forbidden(employeeId ? 'You can only upload your own documents' : 'You are not allowed to upload organization documents');
  }
  if (employeeId) await assertRefsInOrg(ctx.organizationId, { employeeId }, ['employeeId']);
};

/**
 * Validates an attachment id supplied by another module (expense receipt,
 * leave attachment...): it must exist in the organization and have been
 * uploaded by the caller or belong to the given employee.
 */
export const assertAttachment = async (
  ctx: RequestContext,
  fileId: string | Types.ObjectId,
  opts: { employeeId?: Types.ObjectId | null; label?: string; path?: string } = {},
) => {
  const label = opts.label ?? 'Attachment';
  const doc = await DocumentModel.findOne({ _id: fileId, organizationId: ctx.organizationId, deletedAt: null }).select(PUBLIC_SELECT).lean();
  const usable = doc && (ctx.userId.equals(doc.uploadedBy) || (!!opts.employeeId && !!doc.employeeId && opts.employeeId.equals(doc.employeeId)));
  if (!doc || !usable) {
    throw badRequest(`${label} not found`, 'INVALID_REFERENCE', [{ path: opts.path ?? 'fileId', message: `${label} not found` }]);
  }
  return doc;
};

/* ------------------------------ Raw files ----------------------------- */

/** `POST /files` — generic attachment upload used by other modules. */
export const uploadFile = async (ctx: RequestContext, file: UploadedFile, input: FileUpload) => {
  const context = input.context;
  if (context === 'RESUME' && !can(ctx, 'recruitment:create') && !can(ctx, 'recruitment:update')) throw forbidden();
  if (context === 'ANNOUNCEMENT' && !can(ctx, 'announcement:manage')) throw forbidden();
  if (context === 'LOGO' && !can(ctx, 'settings:manage')) throw forbidden();
  if (context === 'ATTENDANCE' && !ctx.employeeId) throw badRequest('No employee profile is linked to your account', 'NO_EMPLOYEE_PROFILE');

  const imageOnly = !!context && IMAGE_CONTEXTS.has(context);
  const stored = await putFile(ctx, file, imageOnly ? IMAGE_MIME_TYPES : DOCUMENT_MIME_TYPES);
  const personal = !context || PERSONAL_CONTEXTS.has(context);
  const _id = new Types.ObjectId();
  try {
    const doc = await DocumentModel.create({
      _id,
      organizationId: ctx.organizationId,
      title: input.title || stored.originalName,
      category: input.category ?? (context === 'RESUME' ? 'RESUME' : 'OTHER'),
      employeeId: personal ? ctx.employeeId : null,
      context: context ?? 'EMPLOYEE',
      ...stored,
      rootDocumentId: _id,
      uploadedBy: ctx.userId,
    });
    return toPublic(doc);
  } catch (err) {
    await discard(stored.storageKey);
    throw err;
  }
};

/** Resolves an authorized file for streaming. */
export const openFile = async (ctx: RequestContext, id: string): Promise<{ doc: LeanDocument; stream: Readable; inlineAllowed: boolean }> => {
  const doc = await DocumentModel.findOne({ _id: id, organizationId: ctx.organizationId, deletedAt: null }).lean();
  if (!doc) throw notFound('File');
  if (!(await canReadDocument(ctx, doc))) throw forbidden('You do not have access to this file');
  let stream: Readable;
  try {
    stream = await storage().getStream(doc.storageKey);
  } catch (err) {
    logger.error({ err, documentId: id }, 'Stored object missing');
    throw notFound('File');
  }
  return { doc, stream, inlineAllowed: INLINE_MIME_TYPES.has(doc.mimeType) };
};

/** `POST /employees/:id/photo` — self or `employee:update`. */
export const uploadEmployeePhoto = async (ctx: RequestContext, employeeId: string, file: UploadedFile) => {
  const emp = await EmployeeModel.findOne({ _id: employeeId, organizationId: ctx.organizationId, deletedAt: null }).select('_id').lean();
  if (!emp) throw notFound('Employee');
  if (!isOwnEmployee(ctx, emp._id) && !can(ctx, 'employee:update')) throw forbidden('You can only change your own photo');
  const stored = await putFile(ctx, file, IMAGE_MIME_TYPES);
  const _id = new Types.ObjectId();
  try {
    await DocumentModel.create({
      _id,
      organizationId: ctx.organizationId,
      title: 'Profile photo',
      category: 'OTHER',
      employeeId: emp._id,
      context: 'AVATAR',
      ...stored,
      rootDocumentId: _id,
      uploadedBy: ctx.userId,
    });
  } catch (err) {
    await discard(stored.storageKey);
    throw err;
  }
  const result = await setProfilePhoto(ctx, String(emp._id), String(_id));
  return { ...result, fileId: _id };
};

/* ------------------------- Documents library -------------------------- */

export const uploadDocument = async (ctx: RequestContext, file: UploadedFile, input: DocumentUpload) => {
  // Without an explicit employee: organization-level for document admins (or policies), own document otherwise.
  const orgLevel = !input.employeeId && (can(ctx, 'document:create') || input.category === 'POLICY' || !ctx.employeeId);
  let employeeId = input.employeeId ? new Types.ObjectId(input.employeeId) : orgLevel ? null : ctx.employeeId;
  let parent: LeanDocument | null = null;
  if (input.parentDocumentId) {
    parent = await DocumentModel.findOne({
      _id: input.parentDocumentId,
      organizationId: ctx.organizationId,
      deletedAt: null,
      context: { $in: LIBRARY_CONTEXTS },
    }).lean();
    if (!parent) throw notFound('Document');
    if (input.employeeId && String(parent.employeeId ?? '') !== input.employeeId) {
      throw badRequest('A new version must belong to the same employee', 'VERSION_MISMATCH');
    }
    employeeId = parent.employeeId ?? null;
  }
  await assertCanWrite(ctx, employeeId);

  const stored = await putFile(ctx, file, DOCUMENT_MIME_TYPES);
  const _id = new Types.ObjectId();
  try {
    const doc = await withTransaction(async (session) => {
      let version = 1;
      let rootDocumentId = _id;
      if (parent) {
        rootDocumentId = parent.rootDocumentId ?? parent._id;
        const last = await DocumentModel.findOne({ organizationId: ctx.organizationId, rootDocumentId })
          .sort({ version: -1 })
          .select('version')
          .session(session ?? null)
          .lean();
        version = Math.max(last?.version ?? 1, parent.version ?? 1) + 1;
        await DocumentModel.updateMany(
          { organizationId: ctx.organizationId, $or: [{ rootDocumentId }, { _id: rootDocumentId }], isLatest: true },
          { isLatest: false },
          { session },
        );
      }
      const [created] = await DocumentModel.create(
        [
          {
            _id,
            organizationId: ctx.organizationId,
            title: input.title,
            category: input.category,
            description: input.description,
            employeeId,
            context: employeeId ? 'EMPLOYEE' : 'ORGANIZATION',
            ...stored,
            version,
            rootDocumentId,
            isLatest: true,
            expiryDate: input.expiryDate ? dateOnly(input.expiryDate) : null,
            confidential: input.confidential,
            uploadedBy: ctx.userId,
          },
        ],
        { session },
      );
      return created!;
    });
    await audit(ctx, {
      action: 'DOCUMENT_UPLOADED',
      module: 'documents',
      recordId: doc._id,
      recordLabel: `${doc.title} v${doc.version}`,
      newValues: { title: doc.title, category: doc.category, employeeId: doc.employeeId, version: doc.version, confidential: doc.confidential },
    });
    // An employee uploading their own document: HR hears about it (in-app) so they can verify it.
    if (doc.employeeId && ctx.employeeId && doc.employeeId.equals(ctx.employeeId)) {
      await notifyHr({
        organizationId: ctx.organizationId,
        alreadyNotified: [ctx.userId],
        type: 'GENERAL',
        title: `New document · ${ctx.userName}`,
        message: `${ctx.userName} uploaded "${doc.title}"${doc.version > 1 ? ` (version ${doc.version})` : ''}. It's waiting to be verified.`,
        link: `/documents?highlight=${String(doc._id)}`,
        entityType: 'Document',
        entityId: doc._id,
        excludeUserId: ctx.userId,
      });
    }
    return toPublic(doc);
  } catch (err) {
    await discard(stored.storageKey);
    throw err;
  }
};

type DocumentListQuery = PaginationQuery & {
  scope?: 'me' | 'team' | 'all' | 'organization';
  employeeId?: string;
  category?: string;
  verificationStatus?: string;
  expiringWithinDays?: number;
};

/** Visibility restriction for library listings (employee scope + org-level documents). */
const libraryVisibility = async (ctx: RequestContext, scopeParam: DocumentListQuery['scope'], employeeId?: string) => {
  if (employeeId) {
    const access = await assertEmployeeAccess(ctx, employeeId, 'document:read');
    const f: FilterQuery<DocumentRecord> = { employeeId: new Types.ObjectId(employeeId) };
    if (access === 'team') f.confidential = false;
    return f;
  }
  if (scopeParam === 'organization') {
    return can(ctx, 'document:read') ? { context: 'ORGANIZATION' } : { context: 'ORGANIZATION', confidential: false };
  }
  const scope = await resolveEmployeeScope(ctx, 'document:read', scopeParam);
  if (scope.employeeIds === null) return {};
  const self = ctx.employeeId;
  const or: FilterQuery<DocumentRecord>[] = [];
  if (self && scope.employeeIds.some((id) => id.equals(self))) or.push({ employeeId: self });
  const others = scope.employeeIds.filter((id) => !self?.equals(id));
  if (others.length) or.push({ employeeId: { $in: others }, confidential: false });
  // Organization-level documents (policies) are readable by every employee.
  if (!scopeParam) or.push({ context: 'ORGANIZATION', confidential: false });
  return or.length ? { $or: or } : { _id: null };
};

export const listDocuments = async (ctx: RequestContext, q: DocumentListQuery) => {
  const and: FilterQuery<DocumentRecord>[] = [await libraryVisibility(ctx, q.scope, q.employeeId)];
  if (q.search) and.push(searchFilter(q.search, ['title', 'originalName']));
  const filter: FilterQuery<DocumentRecord> = {
    organizationId: ctx.organizationId,
    deletedAt: null,
    isLatest: true,
    context: { $in: LIBRARY_CONTEXTS },
    $and: and,
  };
  if (q.category) filter.category = q.category;
  if (q.verificationStatus) filter.verificationStatus = q.verificationStatus;
  if (q.expiringWithinDays !== undefined) {
    const today = todayKey(ctx.timezone);
    filter.expiryDate = { $ne: null, $gte: dateOnly(today), $lte: dateOnly(addDaysKey(today, q.expiringWithinDays)) };
  }
  return paginate(DocumentModel, {
    filter,
    page: q.page,
    limit: q.limit,
    sort: buildSort(q, ['title', 'category', 'createdAt', 'expiryDate', 'verificationStatus'], { createdAt: -1 }),
    select: PUBLIC_SELECT,
    populate: [
      { path: 'employeeId', select: 'employeeId firstName lastName profilePhoto' },
      { path: 'uploadedBy', select: 'firstName lastName' },
    ],
  });
};

const loadLibraryDocument = async (ctx: RequestContext, id: string) => {
  const doc = await DocumentModel.findOne({
    _id: id,
    organizationId: ctx.organizationId,
    deletedAt: null,
    context: { $in: LIBRARY_CONTEXTS },
  }).lean();
  if (!doc) throw notFound('Document');
  if (!(await canReadDocument(ctx, doc))) throw forbidden('You do not have access to this document');
  return doc;
};

const versionsOf = (ctx: RequestContext, doc: LeanDocument) =>
  DocumentModel.find({ organizationId: ctx.organizationId, rootDocumentId: doc.rootDocumentId ?? doc._id, deletedAt: null })
    .select(PUBLIC_SELECT)
    .populate({ path: 'uploadedBy', select: 'firstName lastName' })
    .sort({ version: -1 })
    .lean();

export const getDocument = async (ctx: RequestContext, id: string) => {
  const doc = await loadLibraryDocument(ctx, id);
  const [full, versions] = await Promise.all([
    DocumentModel.findById(doc._id)
      .select(PUBLIC_SELECT)
      .populate([
        { path: 'employeeId', select: 'employeeId firstName lastName profilePhoto' },
        { path: 'uploadedBy', select: 'firstName lastName' },
        { path: 'verifiedBy', select: 'firstName lastName' },
      ])
      .lean(),
    versionsOf(ctx, doc),
  ]);
  return { ...full, url: `/api/v1/files/${String(doc._id)}`, versions };
};

export const listVersions = async (ctx: RequestContext, id: string) => versionsOf(ctx, await loadLibraryDocument(ctx, id));

export const verifyDocument = async (ctx: RequestContext, id: string, input: DocumentVerify) => {
  const doc = await DocumentModel.findOne({ _id: id, organizationId: ctx.organizationId, deletedAt: null, context: { $in: LIBRARY_CONTEXTS } });
  if (!doc) throw notFound('Document');
  if (isOwnEmployee(ctx, doc.employeeId)) throw forbidden('You cannot verify your own document');
  const before = { verificationStatus: doc.verificationStatus, verificationNote: doc.verificationNote };
  doc.verificationStatus = input.status;
  doc.verificationNote = input.note;
  doc.verifiedBy = ctx.userId;
  doc.verifiedAt = new Date();
  await doc.save();
  await audit(ctx, {
    action: 'DOCUMENT_VERIFIED',
    module: 'documents',
    recordId: doc._id,
    recordLabel: doc.title,
    oldValues: before,
    newValues: { verificationStatus: doc.verificationStatus, verificationNote: doc.verificationNote },
  });
  if (doc.employeeId) {
    await notify({
      organizationId: ctx.organizationId,
      userIds: await userIdsForEmployees(ctx.organizationId, [doc.employeeId]),
      type: 'GENERAL',
      title: `Document ${input.status === 'VERIFIED' ? 'verified' : 'rejected'}`,
      message: `"${doc.title}" was ${input.status.toLowerCase()}${input.note ? `: ${input.note}` : ''}`,
      link: `/documents?highlight=${String(doc._id)}`,
      entityType: 'Document',
      entityId: doc._id,
      excludeUserId: ctx.userId,
    });
  }
  return toPublic(doc);
};

export const deleteDocument = async (ctx: RequestContext, id: string) => {
  const doc = await DocumentModel.findOne({ _id: id, organizationId: ctx.organizationId, deletedAt: null, context: { $in: LIBRARY_CONTEXTS } });
  if (!doc) throw notFound('Document');
  const createdAt = (doc.get('createdAt') as Date | undefined)?.getTime() ?? 0;
  const ownRecent =
    ctx.userId.equals(doc.uploadedBy) && Date.now() - createdAt < OWNER_DELETE_WINDOW_MS && doc.verificationStatus !== 'VERIFIED';
  if (!can(ctx, 'document:delete') && !ownRecent) {
    throw forbidden('Only the uploader (within 24 hours, before verification) or document administrators can delete this document');
  }
  await withTransaction(async (session) => {
    const wasLatest = doc.isLatest;
    doc.deletedAt = new Date();
    doc.isLatest = false;
    await doc.save({ session });
    if (wasLatest) {
      // Promote the previous surviving version so the chain stays visible.
      const previous = await DocumentModel.findOne({
        organizationId: ctx.organizationId,
        rootDocumentId: doc.rootDocumentId ?? doc._id,
        deletedAt: null,
      })
        .sort({ version: -1 })
        .session(session ?? null);
      if (previous) {
        previous.isLatest = true;
        await previous.save({ session });
      }
    }
  });
  // The stored object is retained for history; only a hard purge removes it.
  await audit(ctx, {
    action: 'DOCUMENT_DELETED',
    module: 'documents',
    recordId: doc._id,
    recordLabel: `${doc.title} v${doc.version}`,
    oldValues: { title: doc.title, employeeId: doc.employeeId, version: doc.version },
  });
};

export const expiringDocuments = async (ctx: RequestContext, q: { days?: number; scope?: DocumentListQuery['scope'] }) => {
  const days = q.days ?? 30;
  const today = todayKey(ctx.timezone);
  const docs = await DocumentModel.find({
    organizationId: ctx.organizationId,
    deletedAt: null,
    isLatest: true,
    context: { $in: LIBRARY_CONTEXTS },
    expiryDate: { $ne: null, $lte: dateOnly(addDaysKey(today, days)) },
    $and: [await libraryVisibility(ctx, q.scope)],
  })
    .select(PUBLIC_SELECT)
    .populate({ path: 'employeeId', select: 'employeeId firstName lastName' })
    .sort({ expiryDate: 1 })
    .limit(500)
    .lean();
  const todayMs = dateOnly(today).getTime();
  return docs.map((d) => {
    const daysLeft = Math.round(((d.expiryDate as Date).getTime() - todayMs) / 86_400_000);
    return { ...d, daysLeft, expired: daysLeft < 0 };
  });
};

/* -------------------------------- Jobs -------------------------------- */

/** Notifies owners and HR about documents nearing expiry (once per document version). */
export const runDocumentExpiryReminders = async () => {
  const orgs = await OrganizationModel.find({ status: 'ACTIVE' }).select('timezone settings.notifications').lean();
  let sent = 0;
  for (const org of orgs) {
    const days = org.settings?.notifications?.documentExpiryDays ?? 30;
    const horizon = dateOnly(addDaysKey(todayKey(org.timezone ?? 'UTC'), days));
    const docs = await DocumentModel.find({
      organizationId: org._id,
      deletedAt: null,
      isLatest: true,
      context: 'EMPLOYEE',
      employeeId: { $ne: null },
      expiryDate: { $ne: null, $lte: horizon },
      expiryNotifiedAt: null,
    })
      .limit(1000)
      .lean();
    if (!docs.length) continue;
    const hrUsers = await userIdsWithPermission(org._id, 'document:verify');
    for (const doc of docs) {
      const emp = await EmployeeModel.findOne({ _id: doc.employeeId, organizationId: org._id })
        .select('firstName lastName userId workEmail employmentStatus')
        .lean();
      // Claim the document first so concurrent workers never double-notify.
      const claimed = await DocumentModel.updateOne({ _id: doc._id, expiryNotifiedAt: null }, { expiryNotifiedAt: new Date() });
      if (!claimed.modifiedCount || !emp || emp.employmentStatus === 'EXITED' || emp.employmentStatus === 'ARCHIVED') continue;
      const expiry = toDateKey(doc.expiryDate as Date);
      const expiryNotice = {
        organizationId: org._id,
        type: 'DOCUMENT_EXPIRY' as const,
        title: 'Document expiring',
        message: `"${doc.title}" of ${emp.firstName} ${emp.lastName} expires on ${expiry}`,
        link: `/documents?highlight=${String(doc._id)}`,
        entityType: 'Document',
        entityId: doc._id,
      };
      // The owner receives the dedicated expiry email below, so in-app only here.
      await notify({ ...expiryNotice, userIds: [emp.userId], skipEmail: true });
      await notify({ ...expiryNotice, userIds: hrUsers.filter((u) => !emp.userId || String(u) !== String(emp.userId)) });
      const user = emp.userId ? await UserModel.findById(emp.userId).select('email firstName').lean() : null;
      const to = user?.email ?? emp.workEmail;
      if (to) await sendEmail(to, 'documentExpiry', { name: emp.firstName, document: doc.title, expiryDate: expiry }, org._id);
      sent += 1;
    }
  }
  return { notified: sent };
};

export const registerDocumentJobs = () => {
  defineScheduledJob({
    name: 'documents.expiry-reminders',
    schedule: '0 6 * * *',
    handler: async () => {
      const { notified } = await runDocumentExpiryReminders();
      logger.info({ notified }, 'Document expiry reminders sent');
    },
  });
};
