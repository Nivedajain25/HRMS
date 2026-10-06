import { Types } from 'mongoose';
import type { NotificationType, Permission } from '@stencil/shared';
import { logger } from '../config/logger';
import { EmployeeModel, NotificationModel, NotificationPreferenceModel, RoleModel, UserModel } from '../models';
import { sendEmail } from './email.service';
import { sendPush } from './push.service';

/** Types that default to email delivery (others default to in-app only). */
const EMAIL_BY_DEFAULT = new Set<NotificationType>([
  'LEAVE_APPROVED',
  'LEAVE_REJECTED',
  'LEAVE_SUBMITTED',
  'PAYROLL_GENERATED',
  'DOCUMENT_EXPIRY',
  'INTERVIEW_SCHEDULED',
  'EXPENSE_APPROVAL',
]);

export interface NotifyInput {
  organizationId: Types.ObjectId;
  userIds: (Types.ObjectId | string | null | undefined)[];
  type: NotificationType;
  title: string;
  message: string;
  link?: string;
  entityType?: string;
  entityId?: Types.ObjectId | null;
  /** Exclude the acting user (no self-notifications). */
  excludeUserId?: Types.ObjectId;
  /** In-app only: the caller sends its own templated email. */
  skipEmail?: boolean;
  /** Critical alerts (emergencies): deliver in-app, by email and push regardless of personal preferences. */
  force?: boolean;
  /** In-app only: no phone push (e.g. HR's FYI copies of employee requests). */
  skipPush?: boolean;
}

/**
 * Creates in-app notifications, sends emails and mobile pushes according to
 * each user's preferences (push follows the in-app preference). Never throws
 * into the calling business flow.
 */
export const notify = async (input: NotifyInput) => {
  try {
    const ids = [...new Set(input.userIds.filter(Boolean).map(String))]
      .filter((id) => !input.excludeUserId || id !== String(input.excludeUserId))
      .map((id) => new Types.ObjectId(id));
    if (!ids.length) return;

    const [users, prefs] = await Promise.all([
      UserModel.find({ _id: { $in: ids }, organizationId: input.organizationId, status: 'ACTIVE' })
        .select('email firstName')
        .lean(),
      NotificationPreferenceModel.find({ userId: { $in: ids } }).lean(),
    ]);
    const prefByUser = new Map(prefs.map((p) => [String(p.userId), p.preferences]));

    const inApp: Record<string, unknown>[] = [];
    const pushTo: Types.ObjectId[] = [];
    for (const user of users) {
      const pref = prefByUser.get(String(user._id))?.find((p) => p.type === input.type);
      const wantsInApp = input.force || (pref?.inApp ?? true);
      const wantsEmail = input.force || (pref?.email ?? EMAIL_BY_DEFAULT.has(input.type));
      if (wantsInApp) {
        inApp.push({
          organizationId: input.organizationId,
          userId: user._id,
          type: input.type,
          title: input.title,
          message: input.message,
          link: input.link,
          entityType: input.entityType,
          entityId: input.entityId ?? null,
        });
        // Push mirrors the in-app preference (independent of email / skipEmail).
        if (!input.skipPush) pushTo.push(user._id);
      }
      if (wantsEmail && !input.skipEmail) {
        await sendEmail(
          user.email,
          'notification',
          { name: user.firstName, title: input.title, message: input.message, link: input.link },
          input.organizationId,
        );
      }
    }
    if (inApp.length) await NotificationModel.insertMany(inApp);
    if (pushTo.length) {
      await sendPush(pushTo, {
        title: input.title,
        body: input.message,
        data: { link: input.link, type: input.type, entityId: input.entityId ? String(input.entityId) : null },
      });
    }
  } catch (err) {
    logger.error({ err, type: input.type }, 'Failed to create notifications');
  }
};

/** User ids linked to the given employees. */
export const userIdsForEmployees = async (organizationId: Types.ObjectId, employeeIds: (Types.ObjectId | null | undefined)[]) => {
  const ids = employeeIds.filter((e): e is Types.ObjectId => !!e);
  if (!ids.length) return [];
  const employees = await EmployeeModel.find({ _id: { $in: ids }, organizationId }).select('userId').lean();
  return employees.map((e) => e.userId).filter((u): u is Types.ObjectId => !!u);
};

/** Active users holding a given permission (e.g. all HR approvers). */
export const userIdsWithPermission = async (organizationId: Types.ObjectId, permission: Permission) => {
  const roles = await RoleModel.find({ organizationId, permissions: permission }).select('_id').lean();
  if (!roles.length) return [];
  const users = await UserModel.find({ organizationId, status: 'ACTIVE', roles: { $in: roles.map((r) => r._id) } })
    .select('_id')
    .lean();
  return users.map((u) => u._id);
};

/** Active users in the HR team (HR Admin / HR Manager roles). */
export const hrTeamUserIds = async (organizationId: Types.ObjectId) => {
  const roles = await RoleModel.find({ organizationId, key: { $in: ['hr_admin', 'hr_manager'] } }).select('_id').lean();
  if (!roles.length) return [];
  const users = await UserModel.find({ organizationId, status: 'ACTIVE', roles: { $in: roles.map((r) => r._id) } })
    .select('_id')
    .lean();
  return users.map((u) => u._id);
};

/**
 * Keeps HR informed of an employee's request (leave, regularization, expense, document…) in their notification
 * bell — in-app only, no email or push — even when a manager is the approver. Anyone already notified about it
 * (`alreadyNotified`, e.g. an HR approver) and the person who made the request are skipped. Never throws.
 */
export const notifyHr = async (
  input: Omit<NotifyInput, 'userIds' | 'skipEmail' | 'skipPush' | 'force'> & { alreadyNotified?: (Types.ObjectId | string | null | undefined)[] },
) => {
  try {
    const { alreadyNotified = [], ...rest } = input;
    const skip = new Set(alreadyNotified.filter(Boolean).map(String));
    const hr = (await hrTeamUserIds(input.organizationId)).filter((id) => !skip.has(String(id)));
    if (!hr.length) return;
    await notify({ ...rest, userIds: hr, skipEmail: true, skipPush: true });
  } catch (err) {
    logger.error({ err, type: input.type }, 'Failed to notify HR');
  }
};

/** Manager's user id for an employee. */
export const managerUserId = async (organizationId: Types.ObjectId, managerEmployeeId?: Types.ObjectId | null) => {
  if (!managerEmployeeId) return null;
  const manager = await EmployeeModel.findOne({ _id: managerEmployeeId, organizationId }).select('userId').lean();
  return manager?.userId ?? null;
};

/** Whether a notification type is emailed when the user has no explicit preference. */
export const emailEnabledByDefault = (type: NotificationType) => EMAIL_BY_DEFAULT.has(type);
