import { Types } from 'mongoose';
import { PERMISSION_GROUPS, type RoleInput, type UserCreateInput, type UserUpdateInput } from '@stencil/shared';
import { invalidateAuthCache } from '../middleware/auth';
import { EmployeeModel, OrganizationModel, PermissionModel, RoleModel, UserModel } from '../models';
import { can, type RequestContext } from '../types/context';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../utils/errors';
import { buildSort, paginate, searchFilter } from '../utils/pagination';
import type { PaginationQuery } from '@stencil/shared';
import { audit } from './audit.service';
import { issueActionToken, revokeAllSessions } from './auth.service';
import { sendEmail } from './email.service';
import { env } from '../config/env';

/* --------------------------- Permissions ---------------------------- */

export const listPermissionCatalog = async () => {
  const rows = await PermissionModel.find().lean();
  return Object.entries(PERMISSION_GROUPS).map(([group, def]) => ({
    group,
    label: def.label,
    permissions: rows
      .filter((r) => r.group === group)
      .map((r) => ({ key: r.key, description: r.description })),
  }));
};

/**
 * Privilege escalation guard: a user may only grant permissions they hold
 * themselves. (Super Admins hold every permission.)
 */
const assertCanGrant = (ctx: RequestContext, permissions: string[]) => {
  const missing = permissions.filter((p) => !ctx.permissions.has(p as never));
  if (missing.length) throw forbidden(`You cannot grant permissions you do not have: ${missing.join(', ')}`);
};

/* ------------------------------- Roles ------------------------------ */

export const listRoles = async (ctx: RequestContext) => {
  const roles = await RoleModel.find({ organizationId: ctx.organizationId }).sort({ isSystem: -1, name: 1 }).lean();
  const counts = await UserModel.aggregate<{ _id: Types.ObjectId; count: number }>([
    { $match: { organizationId: ctx.organizationId } },
    { $unwind: '$roles' },
    { $group: { _id: '$roles', count: { $sum: 1 } } },
  ]);
  const byRole = new Map(counts.map((c) => [String(c._id), c.count]));
  return roles.map((r) => ({ ...r, userCount: byRole.get(String(r._id)) ?? 0 }));
};

export const createRole = async (ctx: RequestContext, input: RoleInput) => {
  assertCanGrant(ctx, input.permissions);
  if (await RoleModel.exists({ organizationId: ctx.organizationId, name: input.name })) {
    throw conflict('A role with this name already exists');
  }
  const role = await RoleModel.create({ ...input, organizationId: ctx.organizationId, isSystem: false });
  await audit(ctx, { action: 'ROLE_CREATED', module: 'roles', recordId: role._id, recordLabel: role.name, newValues: input });
  return role.toJSON();
};

export const updateRole = async (ctx: RequestContext, id: string, input: RoleInput) => {
  const role = await RoleModel.findOne({ _id: id, organizationId: ctx.organizationId });
  if (!role) throw notFound('Role');
  if (role.key === 'super_admin') throw forbidden('The Super Admin role cannot be modified');
  if (role.key === 'admin') throw forbidden('The Admin role cannot be modified');
  assertCanGrant(ctx, input.permissions);
  // Removing permissions from a role you hold could lock you out; guard the obvious case.
  const ownRoleIds = (await UserModel.findById(ctx.userId).select('roles').lean())?.roles.map(String) ?? [];
  if (ownRoleIds.includes(String(role._id)) && !input.permissions.includes('role:manage') && role.permissions.includes('role:manage')) {
    throw unprocessable('You cannot remove role management from your own role', 'SELF_LOCKOUT');
  }
  const before = { name: role.name, description: role.description, permissions: [...role.permissions] };
  if (role.isSystem && input.name !== role.name) throw badRequest('System roles cannot be renamed');
  role.name = input.name;
  role.description = input.description ?? '';
  role.set('permissions', input.permissions);
  await role.save();
  invalidateAuthCache();
  await audit(ctx, { action: 'ROLE_UPDATED', module: 'roles', recordId: role._id, recordLabel: role.name, oldValues: before, newValues: input });
  return role.toJSON();
};

export const deleteRole = async (ctx: RequestContext, id: string) => {
  const role = await RoleModel.findOne({ _id: id, organizationId: ctx.organizationId });
  if (!role) throw notFound('Role');
  if (role.isSystem) throw forbidden('System roles cannot be deleted');
  const inUse = await UserModel.countDocuments({ organizationId: ctx.organizationId, roles: role._id });
  if (inUse) throw unprocessable(`This role is assigned to ${inUse} user(s). Reassign them first.`, 'ROLE_IN_USE');
  await role.deleteOne();
  await audit(ctx, { action: 'ROLE_DELETED', module: 'roles', recordId: role._id, recordLabel: role.name });
};

/* ------------------------------- Users ------------------------------ */

const loadRoles = async (ctx: RequestContext, roleIds: string[]) => {
  const roles = await RoleModel.find({ _id: { $in: roleIds }, organizationId: ctx.organizationId }).lean();
  if (roles.length !== new Set(roleIds).size) throw badRequest('One or more roles are invalid', 'INVALID_ROLE');
  // Assigning a role grants its permissions, so the same escalation rule applies.
  assertCanGrant(ctx, roles.flatMap((r) => r.permissions));
  // The Admin role has every permission too, so the Super Admin role itself is guarded separately.
  if (roles.some((r) => r.key === 'super_admin') && !ctx.roleKeys.includes('super_admin')) {
    throw forbidden('Only a Super Admin can give someone the Super Admin role', 'SUPER_ADMIN_ONLY');
  }
  return roles;
};

const countActiveSuperAdmins = async (organizationId: Types.ObjectId) => {
  const role = await RoleModel.findOne({ organizationId, key: 'super_admin' }).select('_id').lean();
  if (!role) return 0;
  return UserModel.countDocuments({ organizationId, roles: role._id, status: 'ACTIVE' });
};

export const listUsers = async (ctx: RequestContext, q: PaginationQuery & { status?: string; roleId?: string }) => {
  const filter: Record<string, unknown> = {
    organizationId: ctx.organizationId,
    ...searchFilter(q.search, ['firstName', 'lastName', 'email']),
  };
  if (q.status) filter.status = q.status;
  if (q.roleId && Types.ObjectId.isValid(q.roleId)) filter.roles = new Types.ObjectId(q.roleId);
  return paginate(UserModel, {
    filter,
    page: q.page,
    limit: q.limit,
    sort: buildSort(q, ['firstName', 'email', 'lastLoginAt', 'createdAt', 'status']),
    populate: [{ path: 'roles', select: 'name key' }, { path: 'employeeId', select: 'employeeId firstName lastName' }],
    select: '-failedLoginAttempts -tokenVersion',
  });
};

/**
 * Creates a user account (optionally linked to an employee) and emails an
 * invitation link to set a password.
 */
export const createUser = async (ctx: RequestContext, input: UserCreateInput) => {
  const roles = await loadRoles(ctx, input.roleIds);
  if (await UserModel.exists({ email: input.email })) throw conflict('A user with this email already exists', 'EMAIL_TAKEN');
  if (input.employeeId) {
    const emp = await EmployeeModel.findOne({ _id: input.employeeId, organizationId: ctx.organizationId, deletedAt: null });
    if (!emp) throw notFound('Employee');
    if (emp.userId) throw conflict('This employee already has a user account');
  }
  const user = await UserModel.create({
    organizationId: ctx.organizationId,
    email: input.email,
    firstName: input.firstName,
    lastName: input.lastName,
    roles: roles.map((r) => r._id),
    employeeId: input.employeeId ?? null,
    status: 'ACTIVE',
    emailVerified: false,
  });
  if (input.employeeId) await EmployeeModel.updateOne({ _id: input.employeeId }, { userId: user._id });
  if (input.sendInvite !== false) await inviteUser(ctx, user._id);
  await audit(ctx, {
    action: 'USER_CREATED',
    module: 'users',
    recordId: user._id,
    recordLabel: user.email,
    newValues: { email: user.email, roles: roles.map((r) => r.name) },
  });
  return user.toJSON();
};

export const inviteUser = async (ctx: RequestContext, userId: Types.ObjectId | string) => {
  const user = await UserModel.findOne({ _id: userId, organizationId: ctx.organizationId }).lean();
  if (!user) throw notFound('User');
  const org = await OrganizationModel.findById(ctx.organizationId).select('name').lean();
  const token = await issueActionToken(user._id, 'INVITE');
  await sendEmail(user.email, 'invite', { name: user.firstName, organization: org?.name ?? 'your organization', token }, ctx.organizationId);
  return { invited: true };
};

/**
 * An activation link for a user who hasn't activated their account yet, for the admin to hand over directly
 * (e.g. on WhatsApp) when email isn't available. The person opens it and sets their own password. Refused once
 * the account is activated, so it can't be used to take over someone's login.
 */
export const inviteLink = async (ctx: RequestContext, userId: string) => {
  const user = await UserModel.findOne({ _id: userId, organizationId: ctx.organizationId }).lean();
  if (!user) throw notFound('User');
  if (user.emailVerified || user.lastLoginAt) throw unprocessable('This account is already activated. They can use “Forgot password” to reset it.', 'ALREADY_ACTIVATED');
  const token = await issueActionToken(user._id, 'INVITE');
  await audit(ctx, { action: 'USER_UPDATED', module: 'users', recordId: user._id, recordLabel: user.email, newValues: { inviteLink: 'issued' } });
  // CLIENT_URL may list several origins (web, mobile web); links go to the first (the web app).
  const base = env.CLIENT_URL.split(',')[0]!.trim().replace(/\/$/, '');
  return { url: `${base}/accept-invite?token=${token}`, expiresInDays: 7 };
};

export const updateUser = async (ctx: RequestContext, id: string, input: UserUpdateInput) => {
  const user = await UserModel.findOne({ _id: id, organizationId: ctx.organizationId });
  if (!user) throw notFound('User');
  const isSelf = user._id.equals(ctx.userId);
  const before = { firstName: user.firstName, lastName: user.lastName, status: user.status, roles: user.roles.map(String) };
  // A Super Admin's roles and status are managed by Super Admins only.
  if ((input.roleIds || (input.status && input.status !== user.status)) && !ctx.roleKeys.includes('super_admin')) {
    const superRole = await RoleModel.findOne({ organizationId: ctx.organizationId, key: 'super_admin' }).select('_id').lean();
    if (superRole && user.roles.some((r) => r.equals(superRole._id))) {
      throw forbidden("Only a Super Admin can change a Super Admin's roles or status", 'SUPER_ADMIN_ONLY');
    }
  }

  if (input.roleIds) {
    if (isSelf) throw forbidden('You cannot change your own roles');
    const roles = await loadRoles(ctx, input.roleIds);
    const superRole = await RoleModel.findOne({ organizationId: ctx.organizationId, key: 'super_admin' }).select('_id').lean();
    const wasSuper = superRole && user.roles.some((r) => r.equals(superRole._id));
    const willBeSuper = superRole && roles.some((r) => r._id.equals(superRole._id));
    if (wasSuper && !willBeSuper && (await countActiveSuperAdmins(ctx.organizationId)) <= 1) {
      throw unprocessable('At least one active Super Admin is required', 'LAST_SUPER_ADMIN');
    }
    user.roles = roles.map((r) => r._id);
  }
  if (input.status && input.status !== user.status) {
    if (isSelf) throw forbidden('You cannot change your own account status');
    const superRole = await RoleModel.findOne({ organizationId: ctx.organizationId, key: 'super_admin' }).select('_id').lean();
    if (
      input.status !== 'ACTIVE' &&
      superRole &&
      user.roles.some((r) => r.equals(superRole._id)) &&
      (await countActiveSuperAdmins(ctx.organizationId)) <= 1
    ) {
      throw unprocessable('At least one active Super Admin is required', 'LAST_SUPER_ADMIN');
    }
    user.status = input.status;
  }
  if (input.firstName) user.firstName = input.firstName;
  if (input.lastName) user.lastName = input.lastName;
  await user.save();

  if (input.status && input.status !== 'ACTIVE') await revokeAllSessions(user._id);
  invalidateAuthCache(String(user._id));
  const after = { firstName: user.firstName, lastName: user.lastName, status: user.status, roles: user.roles.map(String) };
  await audit(ctx, {
    action: input.roleIds ? 'ROLE_CHANGED' : 'USER_UPDATED',
    module: 'users',
    recordId: user._id,
    recordLabel: user.email,
    oldValues: before,
    newValues: after,
  });
  return user.toJSON();
};

export const updatePreferences = async (ctx: RequestContext, prefs: { theme?: string; language?: string }) => {
  const set: Record<string, string> = {};
  if (prefs.theme) set['preferences.theme'] = prefs.theme;
  if (prefs.language) set['preferences.language'] = prefs.language;
  await UserModel.updateOne({ _id: ctx.userId }, { $set: set });
  return { ...prefs };
};

export const canManageUsers = (ctx: RequestContext) => can(ctx, 'user:manage');
