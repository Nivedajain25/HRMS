import argon2 from 'argon2';
import { Types } from 'mongoose';
import type { AuthSession, AuthUser } from '@stencil/types';
import type { LoginInput, RegisterInput } from '@stencil/shared';
import { registerSchema } from '@stencil/shared';
import { logger } from '../config/logger';
import { invalidateAuthCache } from '../middleware/auth';
import {
  ActionTokenModel,
  DocumentModel,
  EmployeeModel,
  OrganizationModel,
  RoleModel,
  SessionModel,
  UserModel,
  type UserDoc,
} from '../models';
import { randomToken, sha256 } from '../utils/crypto';
import { dateOnly, isValidTimeZone, todayKey } from '../utils/dates';
import { badRequest, conflict, unauthorized } from '../utils/errors';
import { withTransaction } from '../utils/transaction';
import { audit } from './audit.service';
import { removeAllDevices } from './device.service';
import { sendEmail } from './email.service';
import { generateEmployeeCode } from './employee-code';
import { provisionDefaults, provisionRoles } from './organization-setup.service';
import {
  accessTokenTtl,
  createRefreshToken,
  hashRefreshToken,
  refreshTokenTtl,
  signAccessToken,
} from './token.service';

export type ClientKind = 'web' | 'mobile';

export interface ClientMeta {
  ipAddress?: string;
  userAgent?: string;
  /** 'mobile' when the request carried `X-Client: mobile`; recorded on new sessions. */
  client?: ClientKind;
}

const HASH_OPTIONS = { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;
export const hashPassword = (password: string) => argon2.hash(password, HASH_OPTIONS);

// Used to equalise timing when the account does not exist (user enumeration defence).
let dummyHash: string | null = null;
const getDummyHash = async () => (dummyHash ??= await hashPassword(randomToken(16)));

const LOCK_MINUTES = 15;
/** Window in which a just-rotated refresh token is treated as a concurrent-tab race, not theft. */
const REFRESH_GRACE_MS = 30_000;
const TOKEN_TTL = { VERIFY_EMAIL: 48 * 3600, RESET_PASSWORD: 3600, INVITE: 7 * 24 * 3600 } as const;

const slugify = (name: string) =>
  `${name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 40) || 'org'}-${randomToken(3)}`;

/* ------------------------------ Tokens ------------------------------ */

export const issueActionToken = async (userId: Types.ObjectId, type: keyof typeof TOKEN_TTL) => {
  const token = randomToken(32);
  await ActionTokenModel.deleteMany({ userId, type, usedAt: null });
  await ActionTokenModel.create({
    userId,
    type,
    tokenHash: sha256(token),
    expiresAt: new Date(Date.now() + TOKEN_TTL[type] * 1000),
  });
  return token;
};

const consumeActionToken = async (token: string, type: keyof typeof TOKEN_TTL) => {
  const record = await ActionTokenModel.findOneAndUpdate(
    { tokenHash: sha256(token), type, usedAt: null, expiresAt: { $gt: new Date() } },
    { usedAt: new Date() },
  );
  if (!record) throw badRequest('This link is invalid or has expired', 'INVALID_TOKEN');
  return record.userId;
};

/* ----------------------------- Sessions ----------------------------- */

const createSession = async (user: UserDoc | { _id: Types.ObjectId; organizationId: Types.ObjectId }, rememberMe: boolean, meta: ClientMeta, family?: string) => {
  const { token, hash } = createRefreshToken();
  const ttl = refreshTokenTtl(rememberMe);
  await SessionModel.create({
    organizationId: user.organizationId,
    userId: user._id,
    tokenHash: hash,
    family: family ?? randomToken(16),
    expiresAt: new Date(Date.now() + ttl * 1000),
    rememberMe,
    client: meta.client ?? 'web',
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent?.slice(0, 300),
  });
  return { refreshToken: token, refreshTtl: ttl };
};

export const buildAuthUser = async (userId: Types.ObjectId | string): Promise<AuthUser> => {
  const user = await UserModel.findById(userId).lean();
  if (!user) throw unauthorized();
  const [roles, org, reports] = await Promise.all([
    RoleModel.find({ _id: { $in: user.roles }, organizationId: user.organizationId }).lean(),
    OrganizationModel.findById(user.organizationId).lean(),
    user.employeeId
      ? EmployeeModel.countDocuments({ organizationId: user.organizationId, managerId: user.employeeId, deletedAt: null })
      : Promise.resolve(0),
  ]);
  if (!org) throw unauthorized();
  const permissions = [...new Set(roles.flatMap((r) => r.permissions))].sort();
  return {
    _id: String(user._id),
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    avatar: user.avatar,
    status: user.status,
    emailVerified: user.emailVerified,
    employeeId: user.employeeId ? String(user.employeeId) : null,
    roles: roles.map((r) => ({ _id: String(r._id), name: r.name, key: r.key ?? undefined })),
    permissions,
    isManager: reports > 0,
    preferences: {
      theme: (user.preferences?.theme as 'light' | 'dark' | 'system') ?? 'system',
      language: user.preferences?.language ?? 'en',
    },
    organization: {
      _id: String(org._id),
      name: org.name,
      logo: org.logo,
      timezone: org.timezone,
      currency: org.currency,
      dateFormat: org.dateFormat,
    },
  };
};

const buildSession = async (user: UserDoc | { _id: Types.ObjectId; organizationId: Types.ObjectId; tokenVersion: number }) => {
  const accessToken = signAccessToken({ sub: String(user._id), org: String(user.organizationId), ver: user.tokenVersion });
  const authUser = await buildAuthUser(user._id);
  return { user: authUser, accessToken, expiresIn: accessTokenTtl() } satisfies AuthSession;
};

const auditCtx = (user: { _id: Types.ObjectId; organizationId: Types.ObjectId; firstName: string; lastName: string }, meta: ClientMeta) => ({
  organizationId: user.organizationId,
  userId: user._id,
  userName: `${user.firstName} ${user.lastName}`,
  ...meta,
});

/* ----------------------------- Use cases ---------------------------- */

export const register = async (raw: RegisterInput, meta: ClientMeta) => {
  const input = registerSchema.parse(raw);
  if (!isValidTimeZone(input.timezone)) throw badRequest('Unknown timezone', 'INVALID_TIMEZONE');
  if (await UserModel.exists({ email: input.email })) throw conflict('An account with this email already exists', 'EMAIL_TAKEN');

  const passwordHash = await hashPassword(input.password);
  const { user, organization } = await withTransaction(async (session) => {
    const [organization] = await OrganizationModel.create(
      [
        {
          name: input.organizationName,
          slug: slugify(input.organizationName),
          email: input.email,
          timezone: input.timezone,
          currency: input.currency,
          country: input.country,
        },
      ],
      { session },
    );
    const roles = await provisionRoles(organization!._id, session);
    const { countryRules } = await provisionDefaults(organization!._id, input.country, session);
    organization!.settings!.payroll!.countryRules = countryRules;
    await organization!.save({ session });

    const userId = new Types.ObjectId();
    const employeeCode = await generateEmployeeCode(organization!._id, session);
    const [employee] = await EmployeeModel.create(
      [
        {
          organizationId: organization!._id,
          employeeId: employeeCode,
          userId,
          firstName: input.firstName,
          lastName: input.lastName,
          workEmail: input.email,
          joiningDate: dateOnly(todayKey(input.timezone)),
          employmentStatus: 'ACTIVE',
        },
      ],
      { session },
    );
    const [user] = await UserModel.create(
      [
        {
          _id: userId,
          organizationId: organization!._id,
          employeeId: employee!._id,
          email: input.email,
          passwordHash,
          firstName: input.firstName,
          lastName: input.lastName,
          roles: [roles.super_admin._id],
          status: 'ACTIVE',
          emailVerified: false,
          passwordChangedAt: new Date(),
        },
      ],
      { session },
    );
    return { user: user!, organization: organization! };
  });

  const token = await issueActionToken(user._id, 'VERIFY_EMAIL');
  await sendEmail(user.email, 'verification', { name: user.firstName, token }, organization._id);
  await audit(auditCtx(user, meta), {
    action: 'ORGANIZATION_REGISTERED',
    module: 'organization',
    recordId: organization._id,
    recordLabel: organization.name,
  });

  const { refreshToken, refreshTtl } = await createSession(user, false, meta);
  user.lastLoginAt = new Date();
  await user.save();
  return { session: await buildSession(user), refreshToken, refreshTtl };
};

export const login = async (input: LoginInput, meta: ClientMeta) => {
  const user = await UserModel.findOne({ email: input.email }).select('+passwordHash');
  const invalid = () => unauthorized('Invalid email or password', 'INVALID_CREDENTIALS');

  if (!user || !user.passwordHash) {
    await argon2.verify(await getDummyHash(), input.password).catch(() => false);
    throw invalid();
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    const minutes = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000);
    throw unauthorized(`Too many failed attempts. Try again in ${minutes} minute(s).`, 'ACCOUNT_LOCKED');
  }

  const valid = await argon2.verify(user.passwordHash, input.password).catch(() => false);
  if (!valid) {
    const org = await OrganizationModel.findById(user.organizationId).select('settings.security').lean();
    const maxAttempts = org?.settings?.security?.maxLoginAttempts ?? 5;
    user.failedLoginAttempts += 1;
    if (user.failedLoginAttempts >= maxAttempts) {
      user.lockedUntil = new Date(Date.now() + LOCK_MINUTES * 60000);
      user.failedLoginAttempts = 0;
    }
    await user.save();
    await audit(auditCtx(user, meta), { action: 'LOGIN_FAILED', module: 'auth', recordId: user._id });
    throw invalid();
  }

  if (user.status !== 'ACTIVE') throw unauthorized('Your account is not active. Contact your administrator.', 'ACCOUNT_INACTIVE');
  const org = await OrganizationModel.findById(user.organizationId).select('status').lean();
  if (!org || org.status !== 'ACTIVE') throw unauthorized('Your organization is not active', 'ORGANIZATION_INACTIVE');

  user.failedLoginAttempts = 0;
  user.lockedUntil = null;
  user.lastLoginAt = new Date();
  await user.save();

  const { refreshToken, refreshTtl } = await createSession(user, input.rememberMe ?? false, meta);
  await audit(auditCtx(user, meta), { action: 'LOGIN', module: 'auth', recordId: user._id });
  return { session: await buildSession(user), refreshToken, refreshTtl };
};

/**
 * Rotates a refresh token. Presenting an already-rotated token is treated as
 * theft: the entire token family is revoked.
 */
export const refresh = async (refreshToken: string | undefined, meta: ClientMeta) => {
  if (!refreshToken) throw unauthorized('No session', 'NO_SESSION');
  const existing = await SessionModel.findOne({ tokenHash: hashRefreshToken(refreshToken) });
  if (!existing) throw unauthorized('Session not found', 'NO_SESSION');

  if (existing.revokedAt) {
    // Benign race: another tab/request rotated this token moments ago. The browser
    // already holds the successor cookie (a mobile client received the successor in
    // the concurrent response), so issue an access token without rotating. Only the
    // successor's hash is stored, so it cannot be re-sent: refreshToken is null.
    const rotatedRecently = !!existing.replacedBy && Date.now() - existing.revokedAt.getTime() < REFRESH_GRACE_MS;
    if (rotatedRecently) {
      const successor = await SessionModel.findOne({ tokenHash: existing.replacedBy, revokedAt: null, expiresAt: { $gt: new Date() } }).lean();
      const graceUser = successor ? await UserModel.findById(existing.userId) : null;
      if (successor && graceUser && graceUser.status === 'ACTIVE') {
        return { session: await buildSession(graceUser), refreshToken: null, refreshTtl: 0 };
      }
    }
    await SessionModel.updateMany({ family: existing.family, revokedAt: null }, { revokedAt: new Date() });
    logger.warn({ userId: existing.userId }, 'Refresh token reuse detected; session family revoked');
    throw unauthorized('Session has been revoked', 'SESSION_REVOKED');
  }
  if (existing.expiresAt < new Date()) throw unauthorized('Session expired', 'SESSION_EXPIRED');

  const user = await UserModel.findById(existing.userId);
  if (!user || user.status !== 'ACTIVE') throw unauthorized('Your account is not active', 'ACCOUNT_INACTIVE');

  const { token, hash } = createRefreshToken();
  const claimed = await SessionModel.findOneAndUpdate(
    { _id: existing._id, revokedAt: null },
    { revokedAt: new Date(), replacedBy: hash },
  );
  // Lost a race with a concurrent refresh using the same token.
  if (!claimed) throw unauthorized('Session has been revoked', 'SESSION_REVOKED');

  await SessionModel.create({
    organizationId: existing.organizationId,
    userId: existing.userId,
    tokenHash: hash,
    family: existing.family,
    expiresAt: existing.expiresAt,
    rememberMe: existing.rememberMe,
    // A session family keeps the client kind it was created with.
    client: existing.client ?? meta.client ?? 'web',
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent?.slice(0, 300),
  });
  const refreshTtl = Math.max(60, Math.floor((existing.expiresAt.getTime() - Date.now()) / 1000));
  return { session: await buildSession(user), refreshToken: token, refreshTtl };
};

export const logout = async (refreshToken: string | undefined, meta: ClientMeta) => {
  if (!refreshToken) return;
  const session = await SessionModel.findOneAndUpdate(
    { tokenHash: hashRefreshToken(refreshToken), revokedAt: null },
    { revokedAt: new Date() },
  );
  if (!session) return;
  const user = await UserModel.findById(session.userId).lean();
  if (user) await audit(auditCtx(user, meta), { action: 'LOGOUT', module: 'auth', recordId: user._id });
};

/**
 * Revokes every session, invalidates outstanding access tokens and removes all
 * push devices (sign-out everywhere, password change/reset, deactivation).
 */
export const revokeAllSessions = async (userId: Types.ObjectId) => {
  await SessionModel.updateMany({ userId, revokedAt: null }, { revokedAt: new Date() });
  await removeAllDevices(userId);
  await UserModel.updateOne({ _id: userId }, { $inc: { tokenVersion: 1 } });
  invalidateAuthCache(String(userId));
};

export const forgotPassword = async (email: string) => {
  const user = await UserModel.findOne({ email }).lean();
  // Always respond identically whether or not the account exists.
  if (!user || user.status !== 'ACTIVE') return;
  const token = await issueActionToken(user._id, 'RESET_PASSWORD');
  await sendEmail(user.email, 'passwordReset', { name: user.firstName, token }, user.organizationId);
};

export const resetPassword = async (token: string, password: string, meta: ClientMeta) => {
  const userId = await consumeActionToken(token, 'RESET_PASSWORD');
  const user = await UserModel.findById(userId);
  if (!user) throw badRequest('This link is invalid or has expired', 'INVALID_TOKEN');
  user.passwordHash = await hashPassword(password);
  user.passwordChangedAt = new Date();
  user.failedLoginAttempts = 0;
  user.lockedUntil = null;
  // Proving control of the mailbox also verifies it.
  user.emailVerified = true;
  await user.save();
  await revokeAllSessions(user._id);
  await audit(auditCtx(user, meta), { action: 'PASSWORD_RESET', module: 'auth', recordId: user._id });
};

export const verifyEmail = async (token: string) => {
  const userId = await consumeActionToken(token, 'VERIFY_EMAIL');
  await UserModel.updateOne({ _id: userId }, { emailVerified: true });
  invalidateAuthCache(String(userId));
};

export const resendVerification = async (userId: Types.ObjectId) => {
  const user = await UserModel.findById(userId).lean();
  if (!user || user.emailVerified) return;
  const token = await issueActionToken(user._id, 'VERIFY_EMAIL');
  await sendEmail(user.email, 'verification', { name: user.firstName, token }, user.organizationId);
};

/**
 * Sets the signed-in user's profile photo from an `AVATAR` upload they made (or clears it). Kept in sync with
 * their employee record's photo when they have one, so both show the same picture.
 */
export const setMyAvatar = async (userId: Types.ObjectId, fileId: string | null) => {
  const user = await UserModel.findById(userId).select('organizationId');
  if (!user) throw unauthorized();
  let url: string | null = null;
  if (fileId) {
    const doc = await DocumentModel.findOne({ _id: fileId, organizationId: user.organizationId, context: 'AVATAR', uploadedBy: userId, deletedAt: null })
      .select('_id mimeType')
      .lean();
    if (!doc) throw badRequest('Upload the photo first', 'AVATAR_NOT_FOUND');
    if (!String(doc.mimeType ?? '').startsWith('image/')) throw badRequest('The profile photo must be an image', 'AVATAR_NOT_IMAGE');
    url = `/api/v1/files/${String(doc._id)}`;
  }
  await UserModel.updateOne({ _id: userId }, { avatar: url });
  await EmployeeModel.updateOne({ organizationId: user.organizationId, userId }, { profilePhoto: url });
  invalidateAuthCache(String(userId));
  return buildAuthUser(userId);
};

export const changePassword = async (userId: Types.ObjectId, currentPassword: string, newPassword: string, meta: ClientMeta) => {
  const user = await UserModel.findById(userId).select('+passwordHash');
  if (!user?.passwordHash) throw unauthorized();
  const valid = await argon2.verify(user.passwordHash, currentPassword).catch(() => false);
  if (!valid) throw badRequest('Current password is incorrect', 'INVALID_PASSWORD', [{ path: 'currentPassword', message: 'Incorrect password' }]);
  user.passwordHash = await hashPassword(newPassword);
  user.passwordChangedAt = new Date();
  await user.save();
  // Sign out everywhere else, then issue a fresh session for this device.
  await revokeAllSessions(user._id);
  const fresh = await UserModel.findById(userId);
  const { refreshToken, refreshTtl } = await createSession(fresh!, false, meta);
  await audit(auditCtx(user, meta), { action: 'PASSWORD_CHANGED', module: 'auth', recordId: user._id });
  return { session: await buildSession(fresh!), refreshToken, refreshTtl };
};

export const acceptInvite = async (token: string, password: string, meta: ClientMeta) => {
  const userId = await consumeActionToken(token, 'INVITE');
  const user = await UserModel.findById(userId);
  if (!user) throw badRequest('This link is invalid or has expired', 'INVALID_TOKEN');
  user.passwordHash = await hashPassword(password);
  user.passwordChangedAt = new Date();
  user.emailVerified = true;
  if (user.status === 'INACTIVE') user.status = 'ACTIVE';
  await user.save();
  const { refreshToken, refreshTtl } = await createSession(user, false, meta);
  await audit(auditCtx(user, meta), { action: 'PASSWORD_CHANGED', module: 'auth', recordId: user._id, newValues: { via: 'invite' } });
  return { session: await buildSession(user), refreshToken, refreshTtl };
};

export const listSessions = async (userId: Types.ObjectId) => {
  const sessions = await SessionModel.find({ userId, revokedAt: null, expiresAt: { $gt: new Date() } })
    .select('client ipAddress userAgent createdAt lastUsedAt expiresAt rememberMe')
    .sort({ createdAt: -1 })
    .lean();
  // Sessions created before the `client` field existed are web sessions.
  return sessions.map((s) => ({ ...s, client: s.client ?? 'web' }));
};

export const revokeSession = async (userId: Types.ObjectId, sessionId: string) => {
  await SessionModel.updateOne({ _id: sessionId, userId }, { revokedAt: new Date() });
};
