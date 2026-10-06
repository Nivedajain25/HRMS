import { Types } from 'mongoose';
import { env, isTest } from '../config/env';
import { logger } from '../config/logger';
import { enqueue, registerJobHandler } from '../jobs/queue';
import { DeviceModel } from '../models';

/**
 * Mobile push notifications through the Expo Push Service.
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

/** Delivers a push job. Exported for tests; normally invoked through the job queue. */
export const deliverPush = async (job: PushJob) => {
  if (!pushEnabled() || !job.userIds.length) return;
  try {
    const devices = await DeviceModel.find({
      userId: { $in: job.userIds.map((id) => new Types.ObjectId(id)) },
      disabledAt: null,
    })
      .select('token')
      .lean();
    if (!devices.length) return;

    const data = Object.fromEntries(Object.entries(job.data ?? {}).filter(([, v]) => v !== undefined && v !== null));
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
