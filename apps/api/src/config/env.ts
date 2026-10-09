import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { z } from 'zod';

// Load the app-level .env first, then the repo root .env as a fallback.
loadEnv({ path: path.resolve(process.cwd(), '.env') });
loadEnv({ path: path.resolve(process.cwd(), '../../.env') });

const bool = z
  .string()
  .optional()
  .transform((v) => v === 'true' || v === '1');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(5000),
  MONGODB_URI: z.string().min(1).default('mongodb://127.0.0.1:27017/stencil_hrms'),
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
  JWT_ACCESS_EXPIRES: z.string().default('15m'),
  JWT_REFRESH_EXPIRES: z.string().default('7d'),
  /** Refresh lifetime when "remember me" is not ticked. */
  JWT_REFRESH_SHORT_EXPIRES: z.string().default('1d'),
  CLIENT_URL: z.string().default('http://localhost:5173'),
  API_URL: z.string().default('http://localhost:5000'),
  COOKIE_SECURE: bool,
  COOKIE_DOMAIN: z.string().optional(),
  TRUST_PROXY: bool,

  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_SECURE: bool,
  EMAIL_FROM: z.string().default('Stencil HRMS <no-reply@stencil.local>'),

  /**
   * Where uploads (profile photos, check-in selfies, documents) are kept. Unset: Cloudinary when CLOUDINARY_URL is
   * set, otherwise `mongo` (the database, GridFS). Both survive redeploys.
   */
  STORAGE_PROVIDER: z.enum(['mongo', 'local', 's3', 'cloudinary']).optional(),
  /** Cloudinary dashboard → "API environment variable": `cloudinary://<api_key>:<api_secret>@<cloud_name>`. */
  CLOUDINARY_URL: z.string().optional(),
  STORAGE_LOCAL_DIR: z.string().default('uploads'),
  MAX_UPLOAD_MB: z.coerce.number().default(10),
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  AWS_REGION: z.string().optional(),
  AWS_BUCKET: z.string().optional(),
  S3_ENDPOINT: z.string().optional(),
  S3_FORCE_PATH_STYLE: bool,

  /**
   * Street address for clock-in/out GPS points, looked up from OpenStreetMap (Nominatim) when the device
   * didn't send one. `off` keeps only the coordinates.
   */
  REVERSE_GEOCODING: z.enum(['on', 'off']).default('on'),

  REDIS_URL: z.string().optional(),
  ENABLE_JOBS: z
    .string()
    .optional()
    .transform((v) => v !== 'false'),
  /** Push notifications via Expo. Default: on, except in tests (must be explicitly 'true'). */
  PUSH_ENABLED: z.string().optional(),
  /** Optional Expo access token (required only when "enhanced push security" is enabled in Expo). */
  EXPO_ACCESS_TOKEN: z.string().optional(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  /** Encryption key for sensitive fields at rest (32+ chars). */
  FIELD_ENCRYPTION_KEY: z.string().min(32, 'FIELD_ENCRYPTION_KEY must be at least 32 characters'),
});

const DEV_DEFAULTS: Record<string, string> = {
  JWT_ACCESS_SECRET: 'dev-access-secret-change-me-0000000000000000',
  JWT_REFRESH_SECRET: 'dev-refresh-secret-change-me-000000000000000',
  FIELD_ENCRYPTION_KEY: 'dev-field-encryption-key-change-me-00000000',
};

const raw = { ...process.env };
if (raw.NODE_ENV !== 'production') {
  for (const [key, value] of Object.entries(DEV_DEFAULTS)) raw[key] ??= value;
}

const parsed = schema.safeParse(raw);
if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  throw new Error(`Invalid environment configuration:\n${issues}`);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
