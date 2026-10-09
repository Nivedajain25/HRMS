import { createVerify, generateKeyPairSync } from 'node:crypto';
import { rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Types } from 'mongoose';
import { afterEach, describe, expect, it } from 'vitest';
import { DeviceModel } from '../../src/models';
import { notify } from '../../src/services/notification.service';
import { EXPO_PUSH_URL, configureFcm, configurePush, fcmSendUrl, parseServiceAccount, type PushTransport } from '../../src/services/push.service';
import { as, createEmployeeUser, registerOrg } from '../helpers';

let seq = 0;
const expoToken = (prefix = 'Exponent') => `${prefix}PushToken[test${Date.now().toString(36)}x${++seq}abcdef]`;
const enc = encodeURIComponent;

interface Captured {
  url: string;
  headers: Record<string, string>;
  messages: { to: string; title: string; body: string; data: Record<string, unknown> }[];
}

/** Fake Expo endpoint: records requests and returns a ticket per message. */
const fakeExpo = (errorFor: Set<string> = new Set()) => {
  const calls: Captured[] = [];
  const transport: PushTransport = async (url, init) => {
    const messages = JSON.parse(init.body) as Captured['messages'];
    calls.push({ url, headers: init.headers, messages });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        data: messages.map((m) =>
          errorFor.has(m.to)
            ? { status: 'error', message: `"${m.to}" is not a registered push notification recipient`, details: { error: 'DeviceNotRegistered' } }
            : { status: 'ok', id: new Types.ObjectId().toString() },
        ),
      }),
    };
  };
  return { calls, transport };
};

afterEach(() => {
  configurePush({});
  configureFcm(undefined);
});

describe('Devices', () => {
  it('registers, lists and deletes own devices (upsert by token)', async () => {
    const { token } = await registerOrg();
    const t = expoToken();
    const reg = await as(token).post('/api/v1/devices', { token: t, platform: 'android', appVersion: '1.0.0', deviceName: 'Pixel 8' });
    expect(reg.status).toBe(200);
    expect(reg.body.data.token).toBe(t);
    expect(reg.body.data.disabledAt).toBeNull();

    // Re-registering the same token updates instead of duplicating; ExpoPushToken[] also accepted.
    const again = await as(token).post('/api/v1/devices', { token: t, platform: 'android', appVersion: '1.1.0' });
    expect(again.status).toBe(200);
    expect(again.body.data.appVersion).toBe('1.1.0');
    const t2 = expoToken('Expo');
    expect((await as(token).post('/api/v1/devices', { token: t2, platform: 'ios' })).status).toBe(200);

    const list = await as(token).get('/api/v1/devices');
    expect(list.status).toBe(200);
    expect(list.body.data.map((d: { token: string }) => d.token).sort()).toEqual([t, t2].sort());

    expect((await as(token).delete(`/api/v1/devices/${enc(t)}`)).status).toBe(200);
    const after = await as(token).get('/api/v1/devices');
    expect(after.body.data.map((d: { token: string }) => d.token)).toEqual([t2]);
  });

  it('rejects invalid tokens and platforms', async () => {
    const { token } = await registerOrg();
    expect((await as(token).post('/api/v1/devices', { token: 'not-a-token', platform: 'android' })).status).toBe(400);
    expect((await as(token).post('/api/v1/devices', { token: 'ExponentPushToken[]', platform: 'android' })).status).toBe(400);
    expect((await as(token).post('/api/v1/devices', { token: expoToken(), platform: 'windows' })).status).toBe(400);
    expect((await as(token).delete(`/api/v1/devices/${enc('garbage')}`)).status).toBe(400);
  });

  it("cannot delete another user's device; re-registering reassigns the token", async () => {
    const admin = await registerOrg();
    const emp = await createEmployeeUser(admin.token);
    const t = expoToken();
    await as(admin.token).post('/api/v1/devices', { token: t, platform: 'ios' });

    expect((await as(emp.token).delete(`/api/v1/devices/${enc(t)}`)).status).toBe(404);
    expect(await DeviceModel.exists({ token: t })).toBeTruthy();

    // Other org, other user: can't see or delete it either.
    const other = await registerOrg();
    expect((await as(other.token).delete(`/api/v1/devices/${enc(t)}`)).status).toBe(404);
    expect((await as(other.token).get('/api/v1/devices')).body.data).toEqual([]);

    // The phone switches accounts: the token moves to the new user.
    await as(emp.token).post('/api/v1/devices', { token: t, platform: 'ios' });
    expect((await as(admin.token).get('/api/v1/devices')).body.data).toEqual([]);
    expect((await as(emp.token).get('/api/v1/devices')).body.data).toHaveLength(1);
  });

  it('notify() pushes to users with in-app enabled, and disables unregistered devices', async () => {
    const admin = await registerOrg();
    const good = expoToken();
    const dead = expoToken();
    await as(admin.token).post('/api/v1/devices', { token: good, platform: 'android' });
    await as(admin.token).post('/api/v1/devices', { token: dead, platform: 'ios' });

    const expo = fakeExpo(new Set([dead]));
    configurePush({ enabled: true, transport: expo.transport });

    const entityId = new Types.ObjectId();
    await notify({
      organizationId: new Types.ObjectId(admin.user.organization._id),
      userIds: [admin.user._id],
      type: 'LEAVE_APPROVED',
      title: 'Leave approved',
      message: 'Your leave was approved',
      link: '/leaves/123',
      entityId,
      skipEmail: true,
    });

    expect(expo.calls).toHaveLength(1);
    const call = expo.calls[0]!;
    expect(call.url).toBe(EXPO_PUSH_URL);
    expect(call.headers['Content-Type']).toBe('application/json');
    expect(call.headers.Authorization).toBeUndefined();
    expect(call.messages.map((m) => m.to).sort()).toEqual([good, dead].sort());
    expect(call.messages[0]).toMatchObject({
      title: 'Leave approved',
      body: 'Your leave was approved',
      data: { link: '/leaves/123', type: 'LEAVE_APPROVED', entityId: String(entityId) },
    });

    expect((await DeviceModel.findOne({ token: dead }).lean())?.disabledAt).toBeTruthy();
    expect((await DeviceModel.findOne({ token: good }).lean())?.disabledAt).toBeNull();

    // Disabled devices are skipped next time.
    await notify({
      organizationId: new Types.ObjectId(admin.user.organization._id),
      userIds: [admin.user._id],
      type: 'LEAVE_APPROVED',
      title: 'Again',
      message: 'Second',
    });
    expect(expo.calls).toHaveLength(2);
    expect(expo.calls[1]!.messages.map((m) => m.to)).toEqual([good]);

    // Re-registering re-enables the device.
    await as(admin.token).post('/api/v1/devices', { token: dead, platform: 'ios' });
    expect((await DeviceModel.findOne({ token: dead }).lean())?.disabledAt).toBeNull();
  });

  it('does not push when in-app is disabled for the type, when push is off, or when Expo fails', async () => {
    const admin = await registerOrg();
    await as(admin.token).post('/api/v1/devices', { token: expoToken(), platform: 'android' });
    const base = {
      organizationId: new Types.ObjectId(admin.user.organization._id),
      userIds: [admin.user._id],
      title: 'T',
      message: 'M',
    };

    // Push disabled (default in tests).
    const expo = fakeExpo();
    configurePush({ transport: expo.transport });
    await notify({ ...base, type: 'LEAVE_APPROVED' });
    expect(expo.calls).toHaveLength(0);

    // In-app disabled for this type → no push.
    configurePush({ enabled: true, transport: expo.transport });
    const prefs = await as(admin.token).put('/api/v1/notifications/preferences', {
      preferences: [{ type: 'LEAVE_APPROVED', inApp: false, email: false }],
    });
    expect(prefs.status).toBe(200);
    await notify({ ...base, type: 'LEAVE_APPROVED' });
    expect(expo.calls).toHaveLength(0);

    // Transport failures never reach the caller.
    configurePush({
      enabled: true,
      transport: async () => {
        throw new Error('network down');
      },
    });
    await expect(notify({ ...base, type: 'LEAVE_REJECTED' })).resolves.toBeUndefined();
  });

  it('sends to Firebase (FCM) tokens directly, Expo tokens through Expo, and disables uninstalled phones', async () => {
    const admin = await registerOrg();
    const fcmGood = 'f'.repeat(30) + ':APA91b' + 'G'.repeat(120);
    const fcmGone = 'g'.repeat(30) + ':APA91b' + 'H'.repeat(120);
    const expo = expoToken();
    for (const token of [fcmGood, fcmGone, expo]) expect((await as(admin.token).post('/api/v1/devices', { token, platform: 'android' })).status).toBeLessThan(300);

    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const sa = { project_id: 'hrms-test', client_email: 'push@hrms-test.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() };
    // The key file pasted as-is, or base64, both work; a broken value turns FCM off instead of crashing.
    expect(parseServiceAccount(JSON.stringify(sa))?.project_id).toBe('hrms-test');
    expect(parseServiceAccount(Buffer.from(JSON.stringify(sa)).toString('base64'))?.client_email).toBe(sa.client_email);
    expect(parseServiceAccount('not json')).toBeNull();
    const keyFile = join(tmpdir(), `firebase-adminsdk-test-${Date.now()}.json`);
    writeFileSync(keyFile, JSON.stringify(sa));
    expect(parseServiceAccount(keyFile)?.project_id).toBe('hrms-test');
    rmSync(keyFile);
    configureFcm(sa);

    const calls: { url: string; headers: Record<string, string>; body: string }[] = [];
    const transport: PushTransport = async (url, init) => {
      calls.push({ url, headers: init.headers, body: init.body });
      if (url.includes('oauth2')) return { ok: true, status: 200, json: async () => ({ access_token: 'ya29.test', expires_in: 3600 }) };
      if (url.startsWith('https://fcm.googleapis.com')) {
        const token = (JSON.parse(init.body) as { message: { token: string } }).message.token;
        return token === fcmGone
          ? { ok: false, status: 404, json: async () => ({ error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } }) }
          : { ok: true, status: 200, json: async () => ({ name: 'projects/hrms-test/messages/1' }) };
      }
      return { ok: true, status: 200, json: async () => ({ data: [{ status: 'ok', id: 'x' }] }) };
    };
    configurePush({ enabled: true, transport });

    await notify({
      organizationId: new Types.ObjectId(admin.user.organization._id),
      userIds: [admin.user._id],
      type: 'LEAVE_APPROVED',
      title: 'Leave approved',
      message: 'Your leave was approved',
      link: '/leaves/123',
      skipEmail: true,
    });

    // Signed in to Google with a JWT signed by the service account key.
    const auth = calls.find((c) => c.url.includes('oauth2'))!;
    const assertion = new URLSearchParams(auth.body).get('assertion')!;
    const [h, p, sig] = assertion.split('.');
    expect(createVerify('RSA-SHA256').update(`${h}.${p}`).verify(publicKey, Buffer.from(sig!, 'base64url'))).toBe(true);
    expect(JSON.parse(Buffer.from(p!, 'base64url').toString())).toMatchObject({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging' });

    // One FCM message per Firebase token, in the format the app displays and opens on tap.
    const fcm = calls.filter((c) => c.url === fcmSendUrl('hrms-test'));
    expect(fcm).toHaveLength(2);
    expect(fcm[0]!.headers.Authorization).toBe('Bearer ya29.test');
    const msg = (JSON.parse(fcm.find((c) => c.body.includes(fcmGood))!.body) as { message: { android: unknown; data: Record<string, string> } }).message;
    expect(msg.android).toEqual({ priority: 'HIGH' });
    expect(msg.data).toMatchObject({ title: 'Leave approved', message: 'Your leave was approved', channelId: 'default' });
    expect(JSON.parse(msg.data.body!)).toMatchObject({ link: '/leaves/123', type: 'LEAVE_APPROVED' });

    // The Expo token still goes through Expo.
    const toExpo = calls.filter((c) => c.url === EXPO_PUSH_URL);
    expect(toExpo).toHaveLength(1);
    expect((JSON.parse(toExpo[0]!.body) as { to: string }[]).map((m) => m.to)).toEqual([expo]);

    // An uninstalled phone (UNREGISTERED) is switched off; the others stay on.
    expect((await DeviceModel.findOne({ token: fcmGone }).lean())?.disabledAt).toBeTruthy();
    expect((await DeviceModel.findOne({ token: fcmGood }).lean())?.disabledAt).toBeNull();
  });

  it('removes all devices on logout-all', async () => {
    const { token, user } = await registerOrg();
    await as(token).post('/api/v1/devices', { token: expoToken(), platform: 'android' });
    await as(token).post('/api/v1/devices', { token: expoToken(), platform: 'ios' });
    expect(await DeviceModel.countDocuments({ userId: user._id })).toBe(2);

    expect((await as(token).post('/api/v1/auth/logout-all')).status).toBe(200);
    expect(await DeviceModel.countDocuments({ userId: user._id })).toBe(0);
  });
});
