import { z } from 'zod';
import {
  DOCUMENT_CATEGORIES,
  DOCUMENT_VERIFICATION,
  documentUploadSchema,
  documentVerifySchema,
  fileUploadSchema,
  idParam,
  optionalObjectId,
  paginationQuery,
} from '@stencil/shared';
import { documentController as docs, fileController as files } from '../controllers/operations.controller';
import { uploadSingle } from '../middleware/upload';
import { createModule } from './registry';

const flag = z.preprocess((v) => v === true || v === 'true' || v === '1', z.boolean()).optional();
const libraryScope = z.enum(['me', 'team', 'all', 'organization']).optional();

/* ------------------------------ Raw files ----------------------------- */

export const fileModule = createModule('Files', '/api/v1/files');
fileModule.route(
  {
    method: 'post',
    path: '/',
    summary: 'Upload an attachment (receipt, resume, announcement attachment, leave proof, avatar, logo)',
    description:
      'Multipart `file` plus optional `context`, `category`, `title`. The real content type is validated from magic bytes. Returns the file id to reference from other modules.',
    before: [uploadSingle()],
    multipart: true,
    body: fileUploadSchema,
  },
  files.upload,
);
fileModule.route(
  {
    method: 'get',
    path: '/:id',
    summary: 'Download or preview a file (authorized, tenant-scoped)',
    description: 'Use `?inline=1` to preview PDFs/images in the browser; other types are always downloaded.',
    params: idParam,
    query: z.object({ inline: flag }),
    binary: true,
  },
  files.download,
);

/** Mounted on the employees base path; complements the People module. */
export const employeePhotoModule = createModule('Employees', '/api/v1/employees');
employeePhotoModule.route(
  {
    method: 'post',
    path: '/:id/photo',
    summary: 'Upload a profile photo (self or employee:update)',
    before: [uploadSingle()],
    multipart: true,
    params: idParam,
  },
  files.uploadPhoto,
);

/* ------------------------- Documents library -------------------------- */

export const documentModule = createModule('Documents', '/api/v1/documents');
documentModule.route(
  {
    method: 'get',
    path: '/',
    summary: 'List documents (latest versions; scoped me/team/all/organization)',
    query: paginationQuery.extend({
      scope: libraryScope,
      employeeId: optionalObjectId,
      category: z.enum(DOCUMENT_CATEGORIES).optional(),
      verificationStatus: z.enum(DOCUMENT_VERIFICATION).optional(),
      expiringWithinDays: z.coerce.number().int().min(0).max(3650).optional(),
    }),
  },
  docs.list,
);
documentModule.route(
  {
    method: 'get',
    path: '/expiring',
    summary: 'Documents expiring within N days (includes already expired)',
    query: z.object({ days: z.coerce.number().int().min(0).max(3650).default(30), scope: libraryScope }),
  },
  docs.expiring,
);
documentModule.route(
  {
    method: 'post',
    path: '/',
    summary: 'Upload an employee or organization document (optionally a new version)',
    description: 'Own documents may be uploaded by anyone; other employees and organization-level documents require `document:create`.',
    before: [uploadSingle()],
    multipart: true,
    body: documentUploadSchema,
  },
  docs.upload,
);
documentModule.route({ method: 'get', path: '/:id', summary: 'Document metadata with version list', params: idParam }, docs.get);
documentModule.route({ method: 'get', path: '/:id/versions', summary: 'Version history', params: idParam }, docs.versions);
documentModule.route(
  { method: 'post', path: '/:id/verify', summary: 'Verify or reject a document', permissions: ['document:verify'], params: idParam, body: documentVerifySchema },
  docs.verify,
);
documentModule.route(
  {
    method: 'delete',
    path: '/:id',
    summary: 'Delete a document (soft)',
    description: 'Requires `document:delete`, or the uploader within 24 hours if not yet verified. The stored file is retained for history.',
    params: idParam,
  },
  docs.remove,
);
