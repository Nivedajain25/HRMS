import type { NextFunction, Request, Response } from 'express';
import type { z } from 'zod';
import { badRequest } from '../utils/errors';

interface Schemas {
  body?: z.ZodType;
  query?: z.ZodType;
  params?: z.ZodType;
}

export const zodIssuesToErrors = (error: z.ZodError) =>
  error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));

/** Validates request parts with Zod and stores the parsed output on `req.valid`. */
export const validate =
  (schemas: Schemas) =>
  (req: Request, _res: Response, next: NextFunction) => {
    req.valid = {};
    for (const part of ['params', 'query', 'body'] as const) {
      const schema = schemas[part];
      if (!schema) continue;
      const result = schema.safeParse(req[part] ?? {});
      if (!result.success) throw badRequest('Validation failed', 'VALIDATION_ERROR', zodIssuesToErrors(result.error));
      req.valid[part] = result.data;
    }
    next();
  };

export const body = <T>(req: Request) => req.valid?.body as T;
export const query = <T>(req: Request) => req.valid?.query as T;
export const params = <T>(req: Request) => req.valid?.params as T;
