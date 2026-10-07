import { create } from 'zustand';
import type { AuthUser, MobileAuthSession } from '@stencil/types';
import { hasAnyPermission, hasPermission, type LoginInput, type Permission } from '@stencil/shared';
import { ApiError, del, get, getAccessToken, refreshSession, request, setAccessToken, setSessionHandlers } from './api';
import { queryClient } from './query-client';
import { storage, StorageKeys } from './storage';

/**
 * `loading`  restoring the session on launch
 * `offline`  a stored session exists but the server could not be reached
 */
export type AuthStatus = 'loading' | 'authenticated' | 'anonymous' | 'offline';

interface AuthState {
  status: AuthStatus;
  user: AuthUser | null;
  /** Why the user was signed out (shown on the sign-in screen). */
  signOutReason: string | null;
  /** Error that kept the session from being restored (`offline`). */
  bootError: string | null;
}

export const useAuthStore = create<AuthState>(() => ({ status: 'loading', user: null, signOutReason: null, bootError: null }));

const setSession = (user: AuthUser) => useAuthStore.setState({ user, status: 'authenticated', signOutReason: null, bootError: null });

/** Drops all local session state (tokens, cache). */
const clearLocal = async (reason: string | null) => {
  setAccessToken(null);
  await storage.remove(StorageKeys.refreshToken);
  queryClient.clear();
  useAuthStore.setState({ status: 'anonymous', user: null, signOutReason: reason, bootError: null });
};

let expiring = false;
setSessionHandlers({
  onRefreshed: (session) => {
    if (useAuthStore.getState().status === 'authenticated') useAuthStore.setState({ user: session.user });
  },
  onExpired: () => {
    if (expiring || useAuthStore.getState().status !== 'authenticated') return;
    expiring = true;
    void clearLocal('Your session has expired. Please sign in again.').finally(() => {
      expiring = false;
    });
  },
});

/** Restores the session from the stored refresh token (app launch / retry). */
export const bootstrapSession = async () => {
  useAuthStore.setState({ status: 'loading', bootError: null });
  try {
    const session = await refreshSession();
    if (session) setSession(session.user);
    else await clearLocal(null);
  } catch (err) {
    const e = err instanceof ApiError ? err : null;
    if (e?.code === 'NOT_CONFIGURED') {
      useAuthStore.setState({ status: 'anonymous', user: null, bootError: null });
      return;
    }
    useAuthStore.setState({ status: 'offline', bootError: e?.message ?? 'Cannot reach the server.' });
  }
};

export const signIn = async (input: LoginInput) => {
  const res = await request<{ data: MobileAuthSession }>('/auth/login', { method: 'POST', body: input, auth: false });
  const session = res.data;
  setAccessToken(session.accessToken);
  if (session.refreshToken) await storage.set(StorageKeys.refreshToken, session.refreshToken);
  await storage.set(StorageKeys.lastEmail, input.email);
  queryClient.clear();
  setSession(session.user);
  return session;
};

/** Signs out: unregisters this device from push, revokes the refresh token, clears local state. */
export const signOut = async () => {
  const [refreshToken, pushToken] = await Promise.all([storage.get(StorageKeys.refreshToken), storage.get(StorageKeys.pushToken)]);
  if (getAccessToken() && pushToken) {
    await del(`/devices/${encodeURIComponent(pushToken)}`).catch(() => undefined);
  }
  await storage.remove(StorageKeys.pushToken);
  if (refreshToken) {
    await request('/auth/logout', { method: 'POST', body: { refreshToken }, timeoutMs: 8000 }).catch(() => undefined);
  }
  await clearLocal(null);
};

/** Leaves the offline state without contacting the server (the stored session is discarded). */
export const abandonSession = () => clearLocal(null);

/** Reloads the current user (roles/permissions may have changed). */
export const reloadUser = async () => {
  const user = await get<AuthUser>('/auth/me');
  useAuthStore.setState({ user });
  return user;
};

/** Pre-fills the sign-in form. */
export const getLastEmail = () => storage.get(StorageKeys.lastEmail);

/* -------------------------------- Hooks -------------------------------- */

export const APPROVER_PERMISSIONS: Permission[] = ['leave:approve', 'attendance:approve', 'expense:approve', 'expense:pay'];

export type DashboardKind = 'head' | 'hr' | 'employee';

/** Which dashboard look a user gets, as on the website: Super Admin / Admin ('head'), HR, or everyone else. */
export const dashboardKind = (roles: { key?: string }[] | undefined): DashboardKind => {
  const keys = (roles ?? []).map((r) => r.key);
  if (keys.some((k) => k === 'super_admin' || k === 'admin')) return 'head';
  if (keys.some((k) => k === 'hr_admin' || k === 'hr_manager')) return 'hr';
  return 'employee';
};

export const useAuth = () => {
  const user = useAuthStore((s) => s.user);
  const status = useAuthStore((s) => s.status);
  const granted = user?.permissions ?? [];
  return {
    status,
    user,
    can: (p: Permission) => hasPermission(granted, p),
    canAny: (...ps: Permission[]) => hasAnyPermission(granted, ps),
    isManager: !!user?.isManager || hasPermission(granted, 'team:view'),
    hasEmployee: !!user?.employeeId,
    isApprover: hasAnyPermission(granted, APPROVER_PERMISSIONS),
    /** Organization timezone (falls back to the device's). */
    timeZone: user?.organization.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  };
};
