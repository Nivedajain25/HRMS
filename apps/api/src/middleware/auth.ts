import type { NextFunction, Request, Response } from 'express';
import { Types } from 'mongoose';
import { isPermission, type Permission } from '@stencil/shared';
import { OrganizationModel, RoleModel, UserModel } from '../models';
import { verifyAccessToken } from '../services/token.service';
import type { RequestContext } from '../types/context';
import { forbidden, unauthorized } from '../utils/errors';

interface CachedAuth {
  ctx: Omit<RequestContext, 'ipAddress' | 'userAgent'>;
  tokenVersion: number;
  expires: number;
}

/**
 * Short-lived cache of resolved identities to avoid hitting MongoDB for the
 * user/roles/org on every request. Entries are invalidated explicitly when
 * users or roles change, and expire after a few seconds regardless.
 */
const cache = new Map<string, CachedAuth>();
const CACHE_TTL_MS = 10_000;

export const invalidateAuthCache = (userId?: string) => {
  if (userId) cache.delete(userId);
  else cache.clear();
};

const loadContext = async (userId: string, orgId: string, tokenVersion: number) => {
  const cached = cache.get(userId);
  if (cached && cached.expires > Date.now() && cached.tokenVersion === tokenVersion) return cached.ctx;

  const user = await UserModel.findById(userId).lean();
  if (!user || String(user.organizationId) !== orgId) throw unauthorized('Session is no longer valid', 'SESSION_INVALID');
  if (user.tokenVersion !== tokenVersion) throw unauthorized('Session has been revoked', 'SESSION_REVOKED');
  if (user.status !== 'ACTIVE') throw unauthorized('Your account is not active', 'ACCOUNT_INACTIVE');

  const [roles, org] = await Promise.all([
    RoleModel.find({ _id: { $in: user.roles }, organizationId: user.organizationId }).lean(),
    OrganizationModel.findById(user.organizationId).select('status timezone currency').lean(),
  ]);
  if (!org || org.status !== 'ACTIVE') throw unauthorized('Organization is not active', 'ORGANIZATION_INACTIVE');

  const permissions = new Set<Permission>();
  for (const role of roles) for (const p of role.permissions) if (isPermission(p)) permissions.add(p);

  const ctx: CachedAuth['ctx'] = {
    userId: user._id,
    organizationId: user.organizationId,
    employeeId: user.employeeId ? new Types.ObjectId(String(user.employeeId)) : null,
    userName: `${user.firstName} ${user.lastName}`,
    email: user.email,
    permissions,
    roleKeys: roles.map((r) => r.key).filter((k): k is NonNullable<typeof k> => !!k),
    timezone: org.timezone,
    currency: org.currency,
  };
  cache.set(userId, { ctx, tokenVersion, expires: Date.now() + CACHE_TTL_MS });
  return ctx;
};

export const extractBearer = (req: Request) => {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7).trim();
  return undefined;
};

/** Requires a valid access token and attaches `req.ctx`. */
export const authenticate = async (req: Request, _res: Response, next: NextFunction) => {
  const token = extractBearer(req);
  if (!token) throw unauthorized();
  let payload;
  try {
    payload = verifyAccessToken(token);
  } catch {
    throw unauthorized('Access token is invalid or expired', 'TOKEN_EXPIRED');
  }
  if (!Types.ObjectId.isValid(payload.sub) || !Types.ObjectId.isValid(payload.org)) throw unauthorized();
  const ctx = await loadContext(payload.sub, payload.org, payload.ver);
  req.ctx = { ...ctx, ipAddress: req.ip, userAgent: req.get('user-agent')?.slice(0, 300) };
  next();
};

/** Requires ALL listed permissions. */
export const requirePermission =
  (...permissions: Permission[]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    const ctx = req.ctx;
    if (!ctx) throw unauthorized();
    if (!permissions.every((p) => ctx.permissions.has(p))) throw forbidden();
    next();
  };

/** Requires ANY of the listed permissions. */
export const requireAnyPermission =
  (...permissions: Permission[]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    const ctx = req.ctx;
    if (!ctx) throw unauthorized();
    if (!permissions.some((p) => ctx.permissions.has(p))) throw forbidden();
    next();
  };

/** Returns the authenticated context or throws (for use in controllers). */
export const getCtx = (req: Request): RequestContext => {
  if (!req.ctx) throw unauthorized();
  return req.ctx;
};
