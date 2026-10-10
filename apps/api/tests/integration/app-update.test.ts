import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { announceNewRelease, configureAppReleases, parseRelease, remindToUpdate, type ReleaseFetcher } from '../../src/services/app-update.service';
import { configurePush, type PushTransport } from '../../src/services/push.service';
import { as, getApp, registerOrg } from '../helpers';

let seq = 0;
const expoToken = () => `ExponentPushToken[upd${Date.now().toString(36)}x${++seq}abcdef]`;

const release = (build: number, extra: Record<string, unknown> = {}) => ({
  tag_name: `android-v${build}`,
  name: `Stencil HRMS 1.0.0 (build ${build})`,
  body: `- Change in build ${build}`,
  draft: false,
  prerelease: false,
  published_at: '2026-10-01T10:00:00Z',
  assets: [{ name: 'stencil-hrms.apk', browser_download_url: `https://github.com/o/r/releases/download/android-v${build}/stencil-hrms.apk`, size: 1234 }],
  ...extra,
});

/** Fake GitHub releases endpoint. */
const fakeGithub = (releases: unknown[]) => {
  const calls: string[] = [];
  const fetcher: ReleaseFetcher = async (url) => {
    calls.push(url);
    return { ok: true, status: 200, json: async () => releases };
  };
  return { calls, fetcher };
};

/** Fake Expo push endpoint: records every message. */
const fakeExpo = () => {
  const messages: { to: string; title: string; data: Record<string, unknown> }[] = [];
  const transport: PushTransport = async (_url, init) => {
    const batch = JSON.parse(init.body) as typeof messages;
    messages.push(...batch);
    return { ok: true, status: 200, json: async () => ({ data: batch.map(() => ({ status: 'ok', id: 'x' })) }) };
  };
  return { messages, transport };
};

afterEach(() => {
  configureAppReleases({});
  configurePush({});
});

describe('App updates', () => {
  it('only accepts published android-v<build> releases with the APK attached', () => {
    expect(parseRelease(release(7))).toMatchObject({ build: 7, version: '1.0.0', size: 1234, notes: '- Change in build 7' });
    expect(parseRelease(release(7, { draft: true }))).toBeNull();
    expect(parseRelease(release(7, { prerelease: true }))).toBeNull();
    expect(parseRelease(release(7, { tag_name: 'v7' }))).toBeNull();
    expect(parseRelease(release(7, { assets: [{ name: 'other.apk', browser_download_url: 'https://x/y.apk' }] }))).toBeNull();
  });

  it('GET /app/latest returns the newest release, publicly', async () => {
    const gh = fakeGithub([release(5), release(9), release(12, { draft: true }), { tag_name: 'v1.2.0', assets: [] }]);
    configureAppReleases({ fetcher: gh.fetcher });
    const res = await request(getApp()).get('/api/v1/app/latest');
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ build: 9, url: expect.stringContaining('android-v9/stencil-hrms.apk') });
    // Cached: a second request does not ask GitHub again.
    await request(getApp()).get('/api/v1/app/latest');
    expect(gh.calls).toHaveLength(1);
  });

  it('returns null when GitHub has no release or is unreachable', async () => {
    configureAppReleases({ fetcher: async () => ({ ok: false, status: 403, json: async () => ({}) }) });
    const res = await request(getApp()).get('/api/v1/app/latest');
    expect(res.status).toBe(200);
    expect(res.body.data).toBeNull();
  });

  it('pushes a new release once to phones on an older build, and reminds those still behind', async () => {
    const { token } = await registerOrg();
    const behind = expoToken();
    const current = expoToken();
    const unknown = expoToken();
    expect((await as(token).post('/api/v1/devices', { token: behind, platform: 'android', appBuild: 40 })).status).toBe(200);
    const { token: other } = await registerOrg();
    await as(other).post('/api/v1/devices', { token: current, platform: 'android', appBuild: 41 });
    // An older install without the updater (no build reported) is left alone.
    const { token: third } = await registerOrg();
    await as(third).post('/api/v1/devices', { token: unknown, platform: 'android' });

    configureAppReleases({ fetcher: fakeGithub([release(41)]).fetcher });
    const expo = fakeExpo();
    configurePush({ enabled: true, transport: expo.transport });

    expect(await announceNewRelease()).toBeGreaterThanOrEqual(1);
    const sentTo = expo.messages.map((m) => m.to);
    expect(sentTo).toContain(behind);
    expect(sentTo).not.toContain(current);
    expect(sentTo).not.toContain(unknown);
    expect(expo.messages.find((m) => m.to === behind)?.data).toMatchObject({ type: 'APP_UPDATE', link: '/app-update' });

    // Announced once per release.
    expo.messages.length = 0;
    expect(await announceNewRelease()).toBe(0);
    expect(expo.messages).toHaveLength(0);

    // Daily reminder (once a day) while still behind.
    const now = new Date('2026-10-05T05:00:00Z');
    expect(await remindToUpdate({ now, force: true })).toBeGreaterThanOrEqual(1);
    expect(expo.messages.map((m) => m.to)).toContain(behind);
    expo.messages.length = 0;
    await remindToUpdate({ now, force: true });
    expect(expo.messages.map((m) => m.to)).not.toContain(behind);

    // After updating, no more reminders.
    await as(token).post('/api/v1/devices', { token: behind, platform: 'android', appBuild: 41 });
    await remindToUpdate({ now: new Date('2026-10-06T05:00:00Z'), force: true });
    expect(expo.messages.map((m) => m.to)).not.toContain(behind);
  });
});
