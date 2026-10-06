import type { NextFunction, Request, Response } from 'express';
import type { z } from 'zod';
import { MOBILE_CLIENT_HEADER, MOBILE_CLIENT_VALUE } from '@stencil/shared';
import { badRequest } from '../utils/errors';
import { requireCsrfHeader } from './security';
import { zodIssuesToErrors } from './validate';

/**
 * Mobile client mode: native apps send `X-Client: mobile` (exact value; header
 * name is case-insensitive). They receive the refresh token in the JSON body
 * instead of an HTTP-only cookie and send it back in the body.
 */
export const isMobileClient = (req: Request) => req.get(MOBILE_CLIENT_HEADER) === MOBILE_CLIENT_VALUE;

/**
 * For cookie endpoints (refresh/logout):
 *  - web: the CSRF header is required (the cookie is ambient credentials);
 *  - mobile: no cookie is read, so there is no CSRF risk — instead the body is
 *    validated against `schema` and stored on `req.valid.body`.
 */
export const csrfOrMobileBody =
  (schema: z.ZodType) =>
  (req: Request, res: Response, next: NextFunction) => {
    if (!isMobileClient(req)) {
      requireCsrfHeader(req, res, next);
      return;
    }
    const result = schema.safeParse(req.body ?? {});
    if (!result.success) throw badRequest('Validation failed', 'VALIDATION_ERROR', zodIssuesToErrors(result.error));
    req.valid = { body: result.data };
    next();
  };
