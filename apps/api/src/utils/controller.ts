import type { Request, Response } from 'express';
import type { Pagination } from '@stencil/types';
import { getCtx } from '../middleware/auth';
import type { RequestContext } from '../types/context';
import { ok, paginated } from './response';

type Handler<T> = (ctx: RequestContext, req: Request) => Promise<T>;

/** Thin controller: resolves context, calls the service, wraps the response. */
export const handle =
  <T>(fn: Handler<T>, message?: string, status = 200) =>
  async (req: Request, res: Response) => {
    ok(res, await fn(getCtx(req), req), message, status);
  };

export const handleCreated = <T>(fn: Handler<T>, message = 'Created successfully') => handle(fn, message, 201);

export const handlePaged =
  <T>(fn: Handler<{ items: T[]; pagination: Pagination }>) =>
  async (req: Request, res: Response) => {
    const { items, pagination } = await fn(getCtx(req), req);
    paginated(res, items, pagination);
  };

export const idOf = (req: Request, key = 'id') => String(req.params[key]);
