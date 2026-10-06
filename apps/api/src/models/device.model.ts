import { Schema, model, type InferSchemaType } from 'mongoose';
import { ref, tenantField } from './plugins';

/**
 * A mobile device registered for push notifications (Expo Push Service).
 * A push token belongs to exactly one user at a time: registering an existing
 * token from another account reassigns it.
 */
const deviceSchema = new Schema(
  {
    ...tenantField,
    userId: ref('User', true),
    /** Expo push token (`ExponentPushToken[...]` / `ExpoPushToken[...]`). */
    token: { type: String, required: true, unique: true },
    platform: { type: String, enum: ['android', 'ios'], required: true },
    appVersion: { type: String, default: null },
    deviceName: { type: String, default: null },
    lastSeenAt: { type: Date, default: Date.now },
    /** Set when Expo reports `DeviceNotRegistered`; cleared on re-registration. */
    disabledAt: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false },
);
deviceSchema.index({ userId: 1 });

export type Device = InferSchemaType<typeof deviceSchema>;
export const DeviceModel = model('Device', deviceSchema);
