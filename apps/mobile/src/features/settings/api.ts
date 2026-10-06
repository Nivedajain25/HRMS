import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ActiveSession, MobileAuthSession } from '@stencil/types';
import type { ChangePasswordInput } from '@stencil/shared';
import { del, get, patch, post, refreshSession, setAccessToken } from '@/lib/api';
import { signOut, useAuthStore } from '@/lib/auth';
import { registerForPush } from '@/lib/push';
import { storage, StorageKeys } from '@/lib/storage';
import type { ThemePreference } from '@/theme';

export const sessionKeys = {
  all: ['auth', 'sessions'] as const,
};

export interface SessionList {
  sessions: ActiveSession[];
  /** Best match for this device's session (see `useSessions`), or null. */
  currentId: string | null;
}

/** Tolerated clock difference between the phone and the server when matching this device's session. */
const CLOCK_SKEW_MS = 10 * 60_000;

/**
 * Active sessions. The API does not flag the caller's own session, so the app
 * rotates its refresh token first (which creates a fresh mobile session) and
 * treats the newest mobile session created since then as "This device".
 */
export const useSessions = () =>
  useQuery({
    queryKey: sessionKeys.all,
    queryFn: async (): Promise<SessionList> => {
      const startedAt = Date.now();
      const refreshed = await refreshSession().catch(() => null);
      const sessions = await get<ActiveSession[]>('/auth/sessions');
      let currentId: string | null = null;
      if (refreshed) {
        const newestMobile = sessions
          .filter((s) => s.client === 'mobile')
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
        if (newestMobile && new Date(newestMobile.createdAt).getTime() >= startedAt - CLOCK_SKEW_MS) currentId = newestMobile._id;
      }
      return { sessions, currentId };
    },
    staleTime: 60_000,
  });

export const useRevokeSession = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => del(`/auth/sessions/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: sessionKeys.all }),
  });
};

/** Revokes every session and push device on the server, then clears this device. */
export const signOutEverywhere = async () => {
  await post('/auth/logout-all');
  // The server already removed every push device, including this one.
  await storage.remove(StorageKeys.pushToken);
  await signOut();
};

/**
 * Changes the password. The server signs out every device and returns a fresh
 * session for this one: store it and register this device for push again.
 */
export const useChangePassword = () =>
  useMutation({
    mutationFn: async (input: ChangePasswordInput) => {
      const res = await post<MobileAuthSession>('/auth/change-password', input);
      const session = res.data;
      setAccessToken(session.accessToken);
      if (session.refreshToken) await storage.set(StorageKeys.refreshToken, session.refreshToken);
      useAuthStore.setState({ user: session.user });
      await storage.remove(StorageKeys.pushToken);
      registerForPush().catch((err: unknown) => console.warn('[push] re-registration after password change failed', err));
      return res;
    },
  });

/** Saves the theme on the account so the web app follows it too (best effort). */
export const saveThemePreference = (theme: ThemePreference) => patch('/users/me/preferences', { theme });
