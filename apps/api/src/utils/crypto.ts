import crypto from 'node:crypto';
import { env } from '../config/env';

const key = crypto.createHash('sha256').update(env.FIELD_ENCRYPTION_KEY).digest();
const PREFIX = 'enc:v1:';

/** AES-256-GCM encryption for sensitive fields at rest (bank / identity numbers). */
export const encryptField = (plain: string): string => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${data.toString('base64')}`;
};

export const decryptField = (value: string | null | undefined): string | undefined => {
  if (!value) return undefined;
  if (!value.startsWith(PREFIX)) return value;
  const [iv, tag, data] = value.slice(PREFIX.length).split(':');
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv!, 'base64'));
    decipher.setAuthTag(Buffer.from(tag!, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(data!, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return undefined;
  }
};

export const maskValue = (value: string | undefined, visible = 4) => {
  if (!value) return undefined;
  if (value.length <= visible) return '•'.repeat(value.length);
  return `${'•'.repeat(Math.min(8, value.length - visible))}${value.slice(-visible)}`;
};

export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('hex');

export const sha256 = (value: string) => crypto.createHash('sha256').update(value).digest('hex');
