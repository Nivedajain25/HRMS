import { Linking, Platform } from 'react-native';
import * as Application from 'expo-application';
import { Directory, File, Paths } from 'expo-file-system';
import { getContentUriAsync } from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';
import { useQuery } from '@tanstack/react-query';
import { create } from 'zustand';
import { get } from './api';
import { IN_EXPO_GO } from './config';
import { queryClient } from './query-client';
import { storage, StorageKeys } from './storage';

/**
 * In-app updates (Android). Every APK that GitHub Actions builds is published as a GitHub release; the API's
 * `GET /app/latest` returns the newest one. When it is newer than this install, the update sheet offers to download
 * the APK and hand it to Android's installer, which updates the app in place (same package and signing key).
 */

export interface AppRelease {
  /** Android version code of the APK; higher is newer. */
  build: number;
  version: string | null;
  notes: string;
  url: string;
  size: number | null;
  publishedAt: string | null;
}

/** This install's Android version code; null where in-app updates don't apply (iOS, web, Expo Go, development). */
export const CURRENT_BUILD: number | null = (() => {
  if (Platform.OS !== 'android' || IN_EXPO_GO || __DEV__) return null;
  const build = Number(Application.nativeBuildVersion);
  return build > 0 ? build : null;
})();

export const appReleaseKey = ['app', 'latest'] as const;

/** The newest release (re-checked when the app comes back to the foreground after 15 minutes). */
export const useLatestRelease = () =>
  useQuery({
    queryKey: appReleaseKey,
    queryFn: () => get<AppRelease | null>('/app/latest'),
    enabled: CURRENT_BUILD !== null,
    staleTime: 15 * 60_000,
    refetchInterval: 6 * 60 * 60_000,
  });

export const isNewer = (release: AppRelease | null | undefined): release is AppRelease =>
  !!release && CURRENT_BUILD !== null && release.build > CURRENT_BUILD;

export const checkForUpdate = async () => {
  if (CURRENT_BUILD === null) return null;
  return queryClient.fetchQuery({ queryKey: appReleaseKey, queryFn: () => get<AppRelease | null>('/app/latest'), staleTime: 0 });
};

type Phase = 'idle' | 'downloading' | 'installing' | 'error';

/** Today on the phone's calendar (YYYY-MM-DD). */
export const todayKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * The "Update available" pop-up shows once a day until the app is updated: the day it was last shown is kept on
 * the phone, so closing and reopening the app (or signing in again) the same day doesn't bring it back.
 */
export const useAppUpdateStore = create<{
  phase: Phase;
  /** Download progress 0–1 (null when the size is unknown). */
  progress: number | null;
  error: string | null;
  /** Day the pop-up was last shown; `undefined` until read from storage. */
  shownOn: string | null | undefined;
  /** Opened on purpose (notification tap, Settings): shows even if it was already shown today. */
  requested: boolean;
  loadShownOn: () => Promise<void>;
  markShown: () => void;
  dismiss: () => void;
  request: () => void;
}>((set, getState) => ({
  phase: 'idle',
  progress: null,
  error: null,
  shownOn: undefined,
  requested: false,
  loadShownOn: async () => {
    if (getState().shownOn !== undefined) return;
    set({ shownOn: await storage.get(StorageKeys.updatePromptShownOn) });
  },
  markShown: () => {
    const today = todayKey();
    if (getState().shownOn === today) return;
    set({ shownOn: today });
    void storage.set(StorageKeys.updatePromptShownOn, today);
  },
  dismiss: () => set({ requested: false }),
  request: () => set({ requested: true }),
}));

/** Opens the update sheet (after checking for the newest release), e.g. from an "update available" notification. */
export const openUpdateSheet = () => {
  useAppUpdateStore.getState().request();
  void checkForUpdate().catch(() => undefined);
};

const apkFile = (build: number) => new File(Paths.cache, `stencil-hrms-${build}.apk`);

const FLAG_GRANT_READ_URI_PERMISSION = 1;

/** Shows Android's install screen for a downloaded APK. */
const launchInstaller = async (file: File) => {
  const data = await getContentUriAsync(file.uri);
  await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
    data,
    flags: FLAG_GRANT_READ_URI_PERMISSION,
    type: 'application/vnd.android.package-archive',
  });
};

/**
 * Downloads the release's APK (once; a finished download is reused) and opens Android's installer. If that fails,
 * the download link opens in the browser instead, so the update can still be installed from there.
 */
export const downloadAndInstall = async (release: AppRelease) => {
  const store = useAppUpdateStore;
  if (store.getState().phase === 'downloading') return;
  const file = apkFile(release.build);
  try {
    const complete = file.exists && file.size > 0 && (release.size === null || file.size === release.size);
    if (!complete) {
      store.setState({ phase: 'downloading', progress: release.size ? 0 : null, error: null });
      let shown = -1;
      await File.downloadFileAsync(release.url, file, {
        idempotent: true,
        onProgress: ({ bytesWritten, totalBytes }) => {
          const total = totalBytes > 0 ? totalBytes : release.size;
          if (!total) return;
          const pct = Math.floor((bytesWritten / total) * 100);
          if (pct === shown) return;
          shown = pct;
          store.setState({ progress: Math.min(1, pct / 100) });
        },
      });
    }
    store.setState({ phase: 'installing', progress: 1 });
    await launchInstaller(file);
    // Back from the installer without updating (cancelled, or "Install unknown apps" still off): allow a retry.
    store.setState({ phase: 'idle' });
  } catch (err) {
    console.warn('[update] in-app install failed; opening the download link instead', err);
    try {
      if (file.exists) file.delete();
    } catch {
      /* nothing to clean up */
    }
    store.setState({ phase: 'error', error: 'Could not install the update inside the app. It is downloading in your browser instead — open the file when it finishes.' });
    await Linking.openURL(release.url).catch(() => undefined);
  }
};

/** Deletes downloaded APKs of builds that are already installed (they are ~50 MB each). */
export const cleanUpOldDownloads = () => {
  if (CURRENT_BUILD === null) return;
  try {
    for (const entry of new Directory(Paths.cache).list()) {
      const build = Number(/^stencil-hrms-(\d+)\.apk$/.exec(entry.name)?.[1]);
      if (entry instanceof File && build > 0 && build <= CURRENT_BUILD) entry.delete();
    }
  } catch (err) {
    console.warn('[update] could not clean up old downloads', err);
  }
};
