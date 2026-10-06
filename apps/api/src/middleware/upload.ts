import multer from 'multer';
import { fileTypeFromBuffer } from 'file-type';
import { env } from '../config/env';
import { badRequest } from '../utils/errors';

export const DOCUMENT_MIME_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
] as const;
export const IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;

/** Multer with in-memory buffering and a hard size cap. */
export const uploadSingle = (field = 'file') =>
  multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: env.MAX_UPLOAD_MB * 1024 * 1024, files: 1, fields: 20 },
  }).single(field);

/**
 * Validates the *actual* content type from magic bytes (the client-declared
 * MIME type and extension are not trusted).
 */
export const detectAndValidateMime = async (file: Express.Multer.File | undefined, allowed: readonly string[]) => {
  if (!file) throw badRequest('A file is required', 'FILE_REQUIRED');
  if (file.size === 0) throw badRequest('File is empty', 'FILE_EMPTY');
  const detected = await fileTypeFromBuffer(file.buffer);
  if (!detected || !allowed.includes(detected.mime)) {
    throw badRequest(
      `Unsupported file type. Allowed: ${allowed.map((m) => m.split('/')[1]!.split('.').pop()).join(', ')}`,
      'UNSUPPORTED_FILE_TYPE',
    );
  }
  return detected;
};

/** Filename safe for Content-Disposition. */
export const safeFileName = (name: string) =>
  name
    .normalize('NFKD')
    .replace(/[^\w.\- ]+/g, '')
    .replace(/\s+/g, '_')
    .slice(0, 120) || 'file';
