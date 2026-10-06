import type { Types } from 'mongoose';
import type { AuditAction } from '@stencil/shared';
import { logger } from '../config/logger';
import { AuditLogModel } from '../models';
import type { RequestContext } from '../types/context';

const SENSITIVE_KEYS = new Set([
  'password',
  'passwordHash',
  'bank',
  'identity',
  'accountNumber',
  'accountNumberEncrypted',
  'token',
  'tokenHash',
]);

const clean = (value: unknown, depth = 0): unknown => {
  if (value === null || value === undefined) return value;
  if (depth > 4) return '[…]';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object' && value !== null && '_bsontype' in value) return String(value);
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => clean(v, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (k === '__v' || k === 'updatedAt' || k === 'createdAt') continue;
      out[k] = SENSITIVE_KEYS.has(k) ? '[REDACTED]' : clean(v, depth + 1);
    }
    return out;
  }
  return value;
};

/** Returns only the fields that changed, as `{ oldValues, newValues }`. */
export const diff = (before: Record<string, unknown>, after: Record<string, unknown>) => {
  const oldValues: Record<string, unknown> = {};
  const newValues: Record<string, unknown> = {};
  for (const key of Object.keys(after)) {
    const a = JSON.stringify(clean(before[key]) ?? null);
    const b = JSON.stringify(clean(after[key]) ?? null);
    if (a !== b) {
      oldValues[key] = clean(before[key]) ?? null;
      newValues[key] = clean(after[key]) ?? null;
    }
  }
  return { oldValues, newValues };
};

interface AuditEntry {
  action: AuditAction;
  module: string;
  recordId?: Types.ObjectId | string | null;
  recordLabel?: string;
  oldValues?: unknown;
  newValues?: unknown;
}

/** Writes an audit record. Failures are logged but never break the business action. */
export const audit = async (ctx: Pick<RequestContext, 'organizationId' | 'userId' | 'userName' | 'ipAddress' | 'userAgent'>, entry: AuditEntry) => {
  try {
    await AuditLogModel.create({
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      userName: ctx.userName,
      action: entry.action,
      module: entry.module,
      recordId: entry.recordId ?? null,
      recordLabel: entry.recordLabel,
      oldValues: clean(entry.oldValues ?? null),
      newValues: clean(entry.newValues ?? null),
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      timestamp: new Date(),
    });
  } catch (err) {
    logger.error({ err, action: entry.action }, 'Failed to write audit log');
  }
};
