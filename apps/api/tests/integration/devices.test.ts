import { Types } from 'mongoose';
import { afterEach, describe, expect, it } from 'vitest';
import { DeviceModel } from '../../src/models';
import { notify } from '../../src/services/notification.service';
import { EXPO_PUSH_URL, configurePush, type PushTransport } from '../../src/services/push.service';
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

afterEach(() => configurePush({}));

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

  it('removes all devices on logout-all', async () => {
    const { token, user } = await registerOrg();
    await as(token).post('/api/v1/devices', { token: expoToken(), platform: 'android' });
    await as(token).post('/api/v1/devices', { token: expoToken(), platform: 'ios' });
    expect(await DeviceModel.countDocuments({ userId: user._id })).toBe(2);

    expect((await as(token).post('/api/v1/auth/logout-all')).status).toBe(200);
    expect(await DeviceModel.countDocuments({ userId: user._id })).toBe(0);
  });
});
