import type { Response } from 'express';
import type { Pagination } from '@stencil/types';

export const ok = <T>(res: Response, data: T, message?: string, status = 200) =>
  res.status(status).json({ success: true, data, ...(message ? { message } : {}) });

export const created = <T>(res: Response, data: T, message = 'Created successfully') =>
  ok(res, data, message, 201);

export const paginated = <T>(res: Response, data: T[], pagination: Pagination) =>
  res.json({ success: true, data, pagination });
