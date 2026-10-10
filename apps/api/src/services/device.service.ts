import type { Types } from 'mongoose';
import type { RegisterDeviceInput } from '@stencil/shared';
import { DeviceModel } from '../models';
import type { RequestContext } from '../types/context';
import { notFound } from '../utils/errors';

const PUBLIC_FIELDS = 'token platform appVersion appBuild deviceName lastSeenAt disabledAt createdAt';

/**
 * Registers (or refreshes) the caller's push token. Tokens are unique: an
 * existing token is reassigned to the current user/org (e.g. a shared phone
 * that switched accounts) and re-enabled.
 */
export const registerDevice = async (ctx: RequestContext, input: RegisterDeviceInput) =>
  DeviceModel.findOneAndUpdate(
    { token: input.token },
    {
      $set: {
        organizationId: ctx.organizationId,
        userId: ctx.userId,
        platform: input.platform,
        appVersion: input.appVersion ?? null,
        appBuild: input.appBuild ?? null,
        deviceName: input.deviceName ?? null,
        lastSeenAt: new Date(),
        disabledAt: null,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true, projection: PUBLIC_FIELDS },
  ).lean();

export const listDevices = async (ctx: RequestContext) =>
  DeviceModel.find({ organizationId: ctx.organizationId, userId: ctx.userId }).select(PUBLIC_FIELDS).sort({ lastSeenAt: -1 }).lean();

/** Unregisters one of the caller's own devices; anything else is a 404. */
export const removeDevice = async (ctx: RequestContext, token: string) => {
  const res = await DeviceModel.deleteOne({ token, organizationId: ctx.organizationId, userId: ctx.userId });
  if (!res.deletedCount) throw notFound('Device');
};

/** Removes every device of a user (sign-out everywhere, password change, deactivation). */
export const removeAllDevices = async (userId: Types.ObjectId) => {
  await DeviceModel.deleteMany({ userId });
};
