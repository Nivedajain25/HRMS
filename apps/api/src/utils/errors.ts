import type { ApiFieldError } from '@stencil/types';

export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly code: string = 'ERROR',
    public readonly errors: ApiFieldError[] = [],
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (message: string, code = 'BAD_REQUEST', errors: ApiFieldError[] = []) =>
  new AppError(400, message, code, errors);
export const unauthorized = (message = 'Authentication required', code = 'UNAUTHORIZED') =>
  new AppError(401, message, code);
export const forbidden = (message = 'You do not have permission to perform this action', code = 'FORBIDDEN') =>
  new AppError(403, message, code);
export const notFound = (entity = 'Resource') => new AppError(404, `${entity} not found`, 'NOT_FOUND');
export const conflict = (message: string, code = 'CONFLICT') => new AppError(409, message, code);
export const unprocessable = (message: string, code = 'UNPROCESSABLE') => new AppError(422, message, code);
export const invalidTransition = (entity: string, from: string, to: string) =>
  new AppError(
    422,
    `${entity} cannot move from ${from.replace(/_/g, ' ').toLowerCase()} to ${to.replace(/_/g, ' ').toLowerCase()}`,
    'INVALID_TRANSITION',
  );
