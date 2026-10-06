import { pino } from 'pino';
import { env, isProd, isTest } from './env';

/**
 * Structured logger. Sensitive values are redacted by path so they never reach
 * log sinks even if a whole request/body object is logged by mistake.
 */
export const logger = pino({
  level: isTest ? 'silent' : env.LOG_LEVEL,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
      '*.password',
      '*.passwordHash',
      '*.currentPassword',
      '*.newPassword',
      '*.token',
      '*.accessToken',
      '*.refreshToken',
      '*.accountNumber',
      '*.bank',
      '*.identity',
    ],
    censor: '[REDACTED]',
  },
  ...(isProd
    ? {}
    : { transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } } }),
});
