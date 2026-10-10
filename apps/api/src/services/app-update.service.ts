import type { Types } from 'mongoose';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { defineScheduledJob } from '../jobs/index';
import { claimJobRun } from '../jobs/reminders';
import { DeviceModel, OrganizationModel } from '../models';
import { dateKeyInTz, timeInTz } from '../utils/dates';
import { sendPush } from './push.service';

/**
 * In-app updates for the Android app.
 *
 * Every APK built by GitHub Actions (.github/workflows/android-apk.yml) that passes the emulator check is published
 * as a GitHub release tagged `android-v<build>` with the file `stencil-hrms.apk`, where <build> is the APK's version
 * code. The app asks `GET /app/latest` for the newest one and offers to download and install it when its own build
 * is older. The server checks GitHub every 10 minutes: a new release is pushed once to every phone on an older build,
 * and phones still behind get one reminder a day (10:00 in the organization's timezone) until they update.
 */

export interface AppRelease {
  /** Android version code of the APK; higher is newer. */
  build: number;
  /** Version name (e.g. 1.0.0), when the release title carries one. */
  version: string | null;
  /** What changed (the release description). */
  notes: string;
  /** Direct, public download link of the APK. */
  url: string;
  /** APK size in bytes. */
  size: number | null;
  publishedAt: string | null;
}

export const APP_RELEASE_TAG = /^android-v(\d+)$/;
export const APP_APK_NAME = 'stencil-hrms.apk';
const CACHE_MS = 5 * 60_000;
const MAX_NOTES = 1500;
/** Local hour (organization timezone) of the daily "please update" reminder. */
const REMINDER_HOUR = 10;
/** No reminder in the first hours after a release: the "update available" push just went out. */
const REMINDER_GRACE_MS = 12 * 60 * 60_000;

/** The push that opens the app's update sheet (older apps without the updater just open the notifications list). */
const PUSH_DATA = { type: 'APP_UPDATE', link: '/app-update' } as const;

interface GithubRelease {
  tag_name?: string;
  name?: string | null;
  body?: string | null;
  draft?: boolean;
  prerelease?: boolean;
  published_at?: string | null;
  assets?: { name?: string; browser_download_url?: string; size?: number }[];
}

/** HTTP abstraction so tests never hit GitHub. Defaults to global `fetch`. */
export type ReleaseFetcher = (url: string, init: { headers: Record<string, string> }) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

let fetcherOverride: ReleaseFetcher | undefined;
let cache: { at: number; release: AppRelease | null } | null = null;
let inFlight: Promise<AppRelease | null> | null = null;

/** Test hook: replace the GitHub fetcher (and forget the cached release). Pass `{}` to reset. */
export const configureAppReleases = (opts: { fetcher?: ReleaseFetcher }) => {
  fetcherOverride = opts.fetcher;
  cache = null;
  inFlight = null;
};

const fetcher = (): ReleaseFetcher => fetcherOverride ?? (globalThis.fetch as unknown as ReleaseFetcher);

/** A published `android-v<build>` release with the APK attached, or null for anything else. */
export const parseRelease = (r: GithubRelease): AppRelease | null => {
  if (r.draft || r.prerelease) return null;
  const build = Number(APP_RELEASE_TAG.exec(r.tag_name ?? '')?.[1]);
  const apk = r.assets?.find((a) => a.name === APP_APK_NAME && a.browser_download_url);
  if (!(build > 0) || !apk?.browser_download_url) return null;
  return {
    build,
    version: /\d+\.\d+\.\d+/.exec(r.name ?? '')?.[0] ?? null,
    notes: (r.body ?? '').trim().slice(0, MAX_NOTES),
    url: apk.browser_download_url,
    size: typeof apk.size === 'number' ? apk.size : null,
    publishedAt: r.published_at ?? null,
  };
};

const fetchLatest = async (): Promise<AppRelease | null> => {
  const headers: Record<string, string> = { Accept: 'application/vnd.github+json', 'User-Agent': 'stencil-hrms-api' };
  if (env.GITHUB_TOKEN?.trim()) headers.Authorization = `Bearer ${env.GITHUB_TOKEN.trim()}`;
  const stale = cache?.release ?? null;
  try {
    const res = await fetcher()(`https://api.github.com/repos/${env.APP_RELEASES_REPO}/releases?per_page=20`, { headers });
    if (!res.ok) {
      logger.warn({ status: res.status, repo: env.APP_RELEASES_REPO }, 'Could not check GitHub for a new app release');
      cache = { at: Date.now(), release: stale };
      return stale;
    }
    const list = await res.json();
    const releases = (Array.isArray(list) ? (list as GithubRelease[]) : []).map(parseRelease).filter((r): r is AppRelease => !!r);
    const release = releases.sort((a, b) => b.build - a.build)[0] ?? null;
    cache = { at: Date.now(), release };
    return release;
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'Could not check GitHub for a new app release (network)');
    cache = { at: Date.now(), release: stale };
    return stale;
  }
};

/** The newest Android release (cached for 5 minutes; `fresh` asks GitHub again). Never throws. */
export const latestAppRelease = async ({ fresh = false } = {}): Promise<AppRelease | null> => {
  if (!fresh && cache && Date.now() - cache.at < CACHE_MS) return cache.release;
  inFlight ??= fetchLatest().finally(() => {
    inFlight = null;
  });
  return inFlight;
};

/** Users with an Android phone that reported an older build (optionally only in one organization). */
const usersBehind = async (build: number, organizationId?: Types.ObjectId) =>
  (await DeviceModel.distinct('userId', {
    platform: 'android',
    disabledAt: null,
    appBuild: { $ne: null, $lt: build },
    ...(organizationId ? { organizationId } : {}),
  })) as Types.ObjectId[];

/** Pushes "update available" once per release to every phone on an older build. Returns how many users. */
export const announceNewRelease = async (): Promise<number> => {
  const release = await latestAppRelease({ fresh: true });
  if (!release) return 0;
  if (!(await claimJobRun(`app-release:${release.build}`, 'app-update.release'))) return 0;
  const users = await usersBehind(release.build);
  if (users.length) {
    await sendPush(users, {
      title: 'Update available',
      body: 'A new version of Stencil HRMS is ready. Tap to update now.',
      data: PUSH_DATA,
    });
  }
  logger.info({ build: release.build, users: users.length }, 'New app release announced');
  return users.length;
};

/** The daily reminder for phones still on an older build (10:00 local time, once a day per organization). */
export const remindToUpdate = async (opts: { now?: Date; force?: boolean } = {}): Promise<number> => {
  const now = opts.now ?? new Date();
  const release = await latestAppRelease();
  if (!release) return 0;
  if (release.publishedAt && now.getTime() - new Date(release.publishedAt).getTime() < REMINDER_GRACE_MS) return 0;
  const orgs = await OrganizationModel.find({ status: 'ACTIVE' }).select('timezone').lean();
  let reminded = 0;
  for (const org of orgs) {
    const tz = org.timezone ?? 'UTC';
    if (!opts.force && Number(timeInTz(now, tz).slice(0, 2)) !== REMINDER_HOUR) continue;
    const users = await usersBehind(release.build, org._id);
    if (!users.length) continue;
    if (!(await claimJobRun(`app-update-reminder:${org._id}:${dateKeyInTz(now, tz)}`, 'app-update.reminder', org._id))) continue;
    await sendPush(users, {
      title: 'Please update Stencil HRMS',
      body: "You're using an older version of the app. Tap to install the latest update.",
      data: PUSH_DATA,
    });
    reminded += users.length;
  }
  return reminded;
};

export const registerAppUpdateJobs = () => {
  defineScheduledJob({
    name: 'app-update.check',
    schedule: '*/10 * * * *',
    handler: async () => {
      await announceNewRelease();
    },
  });
  defineScheduledJob({
    name: 'app-update.reminder',
    schedule: '5 * * * *',
    handler: async () => {
      await remindToUpdate();
    },
  });
};
