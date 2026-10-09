import { z } from 'zod';
import { email, objectId, password, requiredString } from './common';

/** Set (or with `null`, remove) my profile photo: the id of a file uploaded with context `AVATAR`. */
export const avatarUpdateSchema = z.object({ fileId: objectId.nullable() });

export const loginSchema = z.object({
  email,
  password: z.string().min(1, 'Password is required').max(128),
  rememberMe: z.boolean().optional().default(false),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const registerSchema = z.object({
  organizationName: requiredString('Organization name', 120),
  firstName: requiredString('First name', 60),
  lastName: requiredString('Last name', 60),
  email,
  password,
  timezone: z.string().min(1).max(64).default('UTC'),
  currency: z.string().length(3).toUpperCase().default('USD'),
  country: z.string().max(80).optional(),
});
export type RegisterInput = z.input<typeof registerSchema>;

export const forgotPasswordSchema = z.object({ email });
export const resetPasswordSchema = z.object({
  token: z.string().min(20).max(200),
  password,
});
export const verifyEmailSchema = z.object({ token: z.string().min(20).max(200) });
export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: password,
  })
  .refine((d) => d.currentPassword !== d.newPassword, {
    message: 'New password must differ from the current password',
    path: ['newPassword'],
  });
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export const acceptInviteSchema = z.object({
  token: z.string().min(20).max(200),
  password,
});

/* ------------------------- Mobile client mode ------------------------- */

/** Header value that selects mobile client mode: `X-Client: mobile`. */
export const MOBILE_CLIENT_HEADER = 'x-client';
export const MOBILE_CLIENT_VALUE = 'mobile';

const refreshToken = z.string().min(64, 'Invalid refresh token').max(200, 'Invalid refresh token');

/** `POST /auth/refresh` body for mobile clients (web clients use the HTTP-only cookie instead). */
export const mobileRefreshSchema = z.object({ refreshToken });
export type MobileRefreshInput = z.infer<typeof mobileRefreshSchema>;

/** `POST /auth/logout` body for mobile clients. */
export const mobileLogoutSchema = z.object({ refreshToken });
export type MobileLogoutInput = z.infer<typeof mobileLogoutSchema>;

/* ------------------------------ Devices ------------------------------ */

export const DEVICE_PLATFORMS = ['android', 'ios'] as const;
export type DevicePlatform = (typeof DEVICE_PLATFORMS)[number];

/** Expo push token: `ExponentPushToken[xxxx]` or `ExpoPushToken[xxxx]`. */
export const EXPO_PUSH_TOKEN_REGEX = /^Expo(nent)?PushToken\[[A-Za-z0-9_-]{8,200}\]$/;
/** Firebase Cloud Messaging registration token (the phone's own token, sent to FCM directly). */
export const FCM_TOKEN_REGEX = /^[A-Za-z0-9_:-]{100,500}$/;
const pushToken = z
  .string()
  .trim()
  .max(500)
  .refine((t) => EXPO_PUSH_TOKEN_REGEX.test(t) || FCM_TOKEN_REGEX.test(t), 'Invalid push token');

export const registerDeviceSchema = z.object({
  token: pushToken,
  platform: z.enum(DEVICE_PLATFORMS),
  appVersion: z.string().trim().max(40).optional(),
  deviceName: z.string().trim().max(120).optional(),
});
export type RegisterDeviceInput = z.infer<typeof registerDeviceSchema>;

export const deviceTokenParam = z.object({ token: pushToken });
