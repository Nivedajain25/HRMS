import type { NextFunction, Request, Response } from 'express';
import mongoose from 'mongoose';
import { MulterError } from 'multer';
import { ZodError } from 'zod';
import { isProd } from '../config/env';
import { logger } from '../config/logger';
import { AppError } from '../utils/errors';
import { zodIssuesToErrors } from './validate';

export const notFoundHandler = (req: Request, res: Response) => {
  res.status(404).json({ success: false, message: `Route ${req.method} ${req.path} not found`, code: 'ROUTE_NOT_FOUND', errors: [] });
};

// Express recognises error handlers by arity, so `_next` must stay.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const errorHandler = (err: unknown, req: Request, res: Response, _next: NextFunction) => {
  let status = 500;
  let code = 'INTERNAL_ERROR';
  let message = 'Something went wrong. Please try again.';
  let errors: { path: string; message: string }[] = [];

  if (err instanceof AppError) {
    status = err.statusCode;
    code = err.code;
    message = err.message;
    errors = err.errors;
  } else if (err instanceof ZodError) {
    status = 400;
    code = 'VALIDATION_ERROR';
    message = 'Validation failed';
    errors = zodIssuesToErrors(err);
  } else if (err instanceof mongoose.Error.ValidationError) {
    status = 400;
    code = 'VALIDATION_ERROR';
    message = 'Validation failed';
    errors = Object.values(err.errors).map((e) => ({ path: e.path, message: e.message }));
  } else if (err instanceof mongoose.Error.CastError) {
    status = 400;
    code = 'INVALID_ID';
    message = `Invalid value for ${err.path}`;
  } else if (err instanceof mongoose.Error.VersionError) {
    status = 409;
    code = 'CONCURRENT_MODIFICATION';
    message = 'This record was modified by someone else. Please retry.';
  } else if (err instanceof MulterError) {
    status = 400;
    code = err.code === 'LIMIT_FILE_SIZE' ? 'FILE_TOO_LARGE' : 'UPLOAD_ERROR';
    message = err.code === 'LIMIT_FILE_SIZE' ? 'File is too large' : err.message;
  } else if (typeof err === 'object' && err !== null && 'code' in err && (err as { code: unknown }).code === 11000) {
    status = 409;
    code = 'DUPLICATE';
    const keys = Object.keys((err as { keyValue?: object }).keyValue ?? {}).filter((k) => k !== 'organizationId');
    message = keys.length ? `A record with this ${keys.join(', ')} already exists` : 'Duplicate record';
    errors = keys.map((k) => ({ path: k, message: 'Already exists' }));
  } else if (typeof err === 'object' && err !== null && 'type' in err && (err as { type: string }).type === 'entity.parse.failed') {
    status = 400;
    code = 'INVALID_JSON';
    message = 'Malformed JSON body';
  } else if (typeof err === 'object' && err !== null && 'statusCode' in err) {
    const e = err as { statusCode: number; code?: string; message?: string };
    status = e.statusCode;
    code = e.code ?? 'ERROR';
    message = e.message ?? message;
  }

  if (status >= 500) {
    logger.error({ err, method: req.method, path: req.path, orgId: req.ctx?.organizationId }, 'Unhandled error');
  } else if (status !== 401 && status !== 404) {
    logger.debug({ code, path: req.path }, message);
  }

  res.status(status).json({
    success: false,
    message,
    code,
    errors,
    ...(!isProd && status >= 500 && err instanceof Error ? { stack: err.stack } : {}),
  });
};
