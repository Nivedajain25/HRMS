import type { NextFunction, Request, Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import { isProd, isTest } from '../config/env';

/**
 * Removes keys that could be interpreted as MongoDB operators or path
 * traversal (`$gt`, `a.b`) from any user-supplied object, recursively.
 */
const scrub = (value: unknown, depth = 0): unknown => {
  if (depth > 20) return undefined;
  if (Array.isArray(value)) return value.map((v) => scrub(v, depth + 1));
  if (value && typeof value === 'object' && !(value instanceof Date) && !Buffer.isBuffer(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (k.startsWith('$') || k.includes('.') || k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
      out[k] = scrub(v, depth + 1);
    }
    return out;
  }
  return value;
};

export const sanitizeInput = (req: Request, _res: Response, next: NextFunction) => {
  if (req.body && typeof req.body === 'object') req.body = scrub(req.body);
  // Express 5 exposes req.query as a getter; redefine it with the sanitized copy.
  const q = scrub({ ...req.query });
  Object.defineProperty(req, 'query', { value: q, writable: true, configurable: true, enumerable: true });
  if (req.params) req.params = scrub(req.params) as Record<string, string>;
  next();
};

const skip = () => isTest;

/** General API limit. */
export const apiLimiter = rateLimit({
  windowMs: 60_000,
  limit: 600,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip,
  message: { success: false, message: 'Too many requests, please slow down', code: 'RATE_LIMITED', errors: [] },
});

/** Strict limit for credential endpoints (brute-force protection). */
export const authLimiter = rateLimit({
  windowMs: 15 * 60_000,
  // Strict in production; relaxed in development so manual QA and E2E runs don't lock out.
  limit: Number(process.env.AUTH_RATE_LIMIT) || (isProd ? 30 : 500),
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip,
  message: {
    success: false,
    message: 'Too many attempts. Please try again in a few minutes.',
    code: 'RATE_LIMITED',
    errors: [],
  },
});

/**
 * CSRF defence for cookie-authenticated endpoints (refresh/logout): the refresh
 * cookie is SameSite=Strict/Lax and these endpoints additionally require a
 * custom header that cross-site forms cannot set.
 */
export const requireCsrfHeader = (req: Request, _res: Response, next: NextFunction) => {
  if (req.get('x-requested-with') !== 'XMLHttpRequest') {
    next(Object.assign(new Error('Missing CSRF header'), { statusCode: 403, code: 'CSRF' }));
    return;
  }
  next();
};
