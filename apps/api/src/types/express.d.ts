import type { RequestContext } from './context';

declare global {
  namespace Express {
    interface Request {
      ctx?: RequestContext;
      /** Parsed & validated data, set by the `validate` middleware. */
      valid?: { body?: unknown; query?: unknown; params?: unknown };
    }
  }
}

export {};
