import { Schema, model, type InferSchemaType } from 'mongoose';
import { ref, tenantField } from './plugins';

/**
 * Refresh-token session. Only a SHA-256 hash of the token is stored.
 * Tokens rotate on every refresh; reuse of a rotated token revokes the family.
 */
const sessionSchema = new Schema(
  {
    ...tenantField,
    userId: ref('User', true),
    tokenHash: { type: String, required: true, unique: true },
    family: { type: String, required: true, index: true },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    replacedBy: { type: String, default: null },
    rememberMe: { type: Boolean, default: false },
    /** Which client created the session family (`X-Client: mobile` → 'mobile'). */
    client: { type: String, enum: ['web', 'mobile'], default: 'web' },
    ipAddress: String,
    userAgent: String,
    lastUsedAt: { type: Date, default: Date.now },
  },
  { timestamps: true, versionKey: false },
);
sessionSchema.index({ userId: 1, revokedAt: 1 });
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 7 });

export type Session = InferSchemaType<typeof sessionSchema>;
export const SessionModel = model('Session', sessionSchema);

/** Single-use tokens for email verification, password reset and invites. */
const actionTokenSchema = new Schema(
  {
    userId: ref('User', true),
    type: { type: String, enum: ['VERIFY_EMAIL', 'RESET_PASSWORD', 'INVITE'], required: true },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false },
);
actionTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
actionTokenSchema.index({ userId: 1, type: 1 });

export const ActionTokenModel = model('ActionToken', actionTokenSchema);
