import { createSign } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { Types } from 'mongoose';
import { EXPO_PUSH_TOKEN_REGEX } from '@stencil/shared';
import { env, isTest } from '../config/env';
import { logger } from '../config/logger';
import { enqueue, registerJobHandler } from '../jobs/queue';
import { DeviceModel } from '../models';

/**
 * Mobile push notifications: phones with a Firebase (FCM) token get them straight from Firebase
 * (FIREBASE_SERVICE_ACCOUNT); older installs with an Expo push token through the Expo Push Service.
 *
 * `sendPush()` enqueues a `push.send` job (BullMQ worker when Redis is
 * configured, in-process otherwise); the handler loads the users' enabled
 * devices and POSTs messages to Expo in chunks of ≤100. Devices Expo reports
 * as `DeviceNotRegistered` are disabled. Nothing here ever throws into callers.
 */

export const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const CHUNK_SIZE = 100;

export interface PushPayload {
  title: string;
  body: string;
  data?: { link?: string; type?: string; entityId?: string | null };
}

interface PushJob extends PushPayload {
  userIds: string[];
}

interface ExpoMessage {
  to: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  sound: 'default';
  priority: 'high';
}

interface ExpoTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
}

/** Transport abstraction so tests never hit the network. Defaults to global `fetch`. */
export type PushTransport = (url: string, init: { method: 'POST'; headers: Record<string, string>; body: string }) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

const blank = (v?: string) => v === undefined || v.trim() === '';
const defaultEnabled = () => {
  if (blank(env.PUSH_ENABLED)) return !isTest;
  return env.PUSH_ENABLED === 'true' || env.PUSH_ENABLED === '1';
};

let enabledOverride: boolean | undefined;
let transportOverride: PushTransport | undefined;

/** Test hook: force push on/off and/or replace the HTTP transport. Pass `{}` to reset. */
export const configurePush = (opts: { enabled?: boolean; transport?: PushTransport }) => {
  enabledOverride = opts.enabled;
  transportOverride = opts.transport;
};

export const pushEnabled = () => enabledOverride ?? defaultEnabled();

const transport = (): PushTransport => transportOverride ?? (globalThis.fetch as unknown as PushTransport);

/** Never log full push tokens. */
const maskToken = (token: string) => `${token.slice(0, 22)}…${token.slice(-4)}`;

const postChunk = async (messages: ExpoMessage[]) => {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Accept-Encoding': 'gzip, deflate',
    'Content-Type': 'application/json',
  };
  if (!blank(env.EXPO_ACCESS_TOKEN)) headers.Authorization = `Bearer ${env.EXPO_ACCESS_TOKEN}`;

  let res: Awaited<ReturnType<PushTransport>>;
  try {
    res = await transport()(EXPO_PUSH_URL, { method: 'POST', headers, body: JSON.stringify(messages) });
  } catch (err) {
    logger.warn({ err: (err as Error).message, count: messages.length }, 'Push delivery failed (network)');
    return;
  }
  if (!res.ok) {
    logger.warn({ status: res.status, count: messages.length }, 'Push delivery failed (Expo HTTP error)');
    return;
  }
  const payload = (await res.json().catch(() => null)) as { data?: ExpoTicket[]; errors?: unknown } | null;
  const tickets = Array.isArray(payload?.data) ? payload.data : [];
  if (payload?.errors) logger.warn({ errors: payload.errors }, 'Expo push request returned errors');

  const unregistered: string[] = [];
  tickets.forEach((ticket, i) => {
    const message = messages[i];
    if (!message || ticket?.status !== 'error') return;
    const error = ticket.details?.error;
    if (error === 'DeviceNotRegistered') unregistered.push(message.to);
    else logger.warn({ error, message: ticket.message, token: maskToken(message.to) }, 'Push ticket error');
  });
  if (unregistered.length) {
    await DeviceModel.updateMany({ token: { $in: unregistered }, disabledAt: null }, { disabledAt: new Date() });
    logger.info({ count: unregistered.length }, 'Disabled unregistered push devices');
  }
};

/* ------------------------- Firebase Cloud Messaging ------------------------ */

/** The Firebase service account (from FIREBASE_SERVICE_ACCOUNT: the key file's JSON, or base64 of it). */
interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
  token_uri?: string;
}

export const parseServiceAccount = (raw: string | undefined): ServiceAccount | null => {
  if (blank(raw)) return null;
  let text = raw!.trim();
  // Locally it can also be the path of the downloaded key file (…-firebase-adminsdk-….json).
  if (/\.json$/i.test(text) && existsSync(text)) text = readFileSync(text, 'utf8');
  for (const candidate of [text, Buffer.from(text, 'base64').toString('utf8')]) {
    try {
      const sa = JSON.parse(candidate) as Partial<ServiceAccount>;
      if (sa.project_id && sa.client_email && sa.private_key) {
        // Keys pasted into a single line keep their newlines as "\n".
        return { ...(sa as ServiceAccount), private_key: sa.private_key.replace(/\\n/g, '\n') };
      }
    } catch {
      /* try the next form */
    }
  }
  logger.warn('FIREBASE_SERVICE_ACCOUNT is set but is not a valid service account key; FCM push is off');
  return null;
};

let serviceAccountOverride: ServiceAccount | null | undefined;
const serviceAccount = () => (serviceAccountOverride !== undefined ? serviceAccountOverride : parseServiceAccount(env.FIREBASE_SERVICE_ACCOUNT));

/** Test hook: use this service account (or none) instead of FIREBASE_SERVICE_ACCOUNT. Pass `undefined` to reset. */
export const configureFcm = (sa: ServiceAccount | null | undefined) => {
  serviceAccountOverride = sa;
  cachedAccess = null;
};

export const fcmConfigured = () => !!serviceAccount();

const base64url = (input: Buffer | string) => Buffer.from(input).toString('base64url');

let cachedAccess: { token: string; expiresAt: number; email: string } | null = null;

/** OAuth access token for FCM: a JWT signed with the service account key, exchanged at Google (cached ~1 h). */
const fcmAccessToken = async (sa: ServiceAccount): Promise<string | null> => {
  if (cachedAccess && cachedAccess.email === sa.client_email && cachedAccess.expiresAt > Date.now() + 60_000) return cachedAccess.token;
  const now = Math.floor(Date.now() / 1000);
  const tokenUri = sa.token_uri ?? 'https://oauth2.googleapis.com/token';
  const unsigned = `${base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${base64url(
    JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: tokenUri, iat: now, exp: now + 3600 }),
  )}`;
  const signature = createSign('RSA-SHA256').update(unsigned).sign(sa.private_key);
  const assertion = `${unsigned}.${base64url(signature)}`;
  const res = await transport()(tokenUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString(),
  });
  const body = (await res.json().catch(() => null)) as { access_token?: string; expires_in?: number; error_description?: string } | null;
  if (!res.ok || !body?.access_token) {
    logger.warn({ status: res.status, error: body?.error_description }, 'FCM sign-in failed (check FIREBASE_SERVICE_ACCOUNT)');
    return null;
  }
  cachedAccess = { token: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000, email: sa.client_email };
  return body.access_token;
};

export const fcmSendUrl = (projectId: string) => `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/messages:send`;

/**
 * One FCM message per device, in the data-only format expo-notifications displays itself (title, `message` text,
 * and our data as a JSON `body`), so tapping it opens the right screen exactly like before. High priority so it
 * shows even when the app is closed.
 */
const fcmMessage = (token: string, job: PushJob, data: Record<string, unknown>) => ({
  message: {
    token,
    android: { priority: 'HIGH' },
    data: { title: job.title, message: job.body, body: JSON.stringify(data), channelId: 'default' },
  },
});

const sendFcm = async (tokens: string[], job: PushJob, data: Record<string, unknown>) => {
  const sa = serviceAccount();
  if (!sa) {
    logger.warn({ count: tokens.length }, 'Push to Firebase tokens skipped: FIREBASE_SERVICE_ACCOUNT is not set');
    return;
  }
  const access = await fcmAccessToken(sa);
  if (!access) return;
  const unregistered: string[] = [];
  const send = async (token: string) => {
    try {
      const res = await transport()(fcmSendUrl(sa.project_id), {
        method: 'POST',
        headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(fcmMessage(token, job, data)),
      });
      if (res.ok) return;
      const body = (await res.json().catch(() => null)) as { error?: { status?: string; message?: string; details?: { errorCode?: string }[] } } | null;
      const code = body?.error?.details?.find((d) => d.errorCode)?.errorCode ?? body?.error?.status;
      // The app was uninstalled or the token rotated: stop sending to it.
      if (res.status === 404 || code === 'UNREGISTERED') unregistered.push(token);
      else logger.warn({ status: res.status, code, message: body?.error?.message, token: maskToken(token) }, 'FCM push error');
    } catch (err) {
      logger.warn({ err: (err as Error).message, token: maskToken(token) }, 'FCM push failed (network)');
    }
  };
  for (let i = 0; i < tokens.length; i += 20) await Promise.all(tokens.slice(i, i + 20).map(send));
  if (unregistered.length) {
    await DeviceModel.updateMany({ token: { $in: unregistered }, disabledAt: null }, { disabledAt: new Date() });
    logger.info({ count: unregistered.length }, 'Disabled unregistered push devices');
  }
};

/** Delivers a push job. Exported for tests; normally invoked through the job queue. */
export const deliverPush = async (job: PushJob) => {
  if (!pushEnabled() || !job.userIds.length) return;
  try {
    const all = await DeviceModel.find({
      userId: { $in: job.userIds.map((id) => new Types.ObjectId(id)) },
      disabledAt: null,
    })
      .select('token')
      .lean();
    if (!all.length) return;

    const data = Object.fromEntries(Object.entries(job.data ?? {}).filter(([, v]) => v !== undefined && v !== null));
    // Phones on the Firebase build register their own FCM token; older installs still have an Expo token.
    const fcmTokens = all.filter((d) => !EXPO_PUSH_TOKEN_REGEX.test(d.token)).map((d) => d.token);
    if (fcmTokens.length) await sendFcm(fcmTokens, job, data);
    const devices = all.filter((d) => EXPO_PUSH_TOKEN_REGEX.test(d.token));
    if (!devices.length) return;
    const messages: ExpoMessage[] = devices.map((d) => ({
      to: d.token,
      title: job.title,
      body: job.body,
      data,
      sound: 'default',
      priority: 'high',
    }));
    for (let i = 0; i < messages.length; i += CHUNK_SIZE) {
      await postChunk(messages.slice(i, i + CHUNK_SIZE));
    }
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'Push delivery failed');
  }
};

registerJobHandler<PushJob>('push.send', deliverPush);

/** Queue a push notification to every enabled device of the given users. Never throws. */
export const sendPush = async (userIds: (Types.ObjectId | string)[], payload: PushPayload) => {
  try {
    if (!pushEnabled()) return;
    const ids = [...new Set(userIds.map(String))];
    if (!ids.length) return;
    // Only enqueue when at least one recipient has a device (avoids empty jobs for web-only users).
    const hasDevice = await DeviceModel.exists({ userId: { $in: ids.map((id) => new Types.ObjectId(id)) }, disabledAt: null });
    if (!hasDevice) return;
    await enqueue('push.send', { userIds: ids, title: payload.title, body: payload.body, data: payload.data ?? {} } satisfies PushJob);
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'Failed to queue push notification');
  }
};
