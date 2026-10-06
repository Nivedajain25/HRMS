import type { Types } from 'mongoose';
import type { Permission } from '@stencil/shared';

/**
 * Authenticated request context. The organization is always derived from the
 * verified token/user — never from client input — and every service receives it.
 */
export interface RequestContext {
  userId: Types.ObjectId;
  organizationId: Types.ObjectId;
  employeeId: Types.ObjectId | null;
  userName: string;
  email: string;
  permissions: ReadonlySet<Permission>;
  roleKeys: string[];
  ipAddress?: string;
  userAgent?: string;
  timezone: string;
  currency: string;
}

export const can = (ctx: RequestContext, permission: Permission) => ctx.permissions.has(permission);
