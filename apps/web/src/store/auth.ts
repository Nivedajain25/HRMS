import { create } from 'zustand';
import type { AuthUser } from '@stencil/types';
import type { Permission } from '@stencil/shared';

type Status = 'loading' | 'authenticated' | 'anonymous';

interface AuthState {
  status: Status;
  user: AuthUser | null;
  /** Access token is kept in memory only (never localStorage) to limit XSS impact. */
  accessToken: string | null;
  setSession: (user: AuthUser, accessToken: string) => void;
  setUser: (user: AuthUser) => void;
  setToken: (token: string) => void;
  clear: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  status: 'loading',
  user: null,
  accessToken: null,
  setSession: (user, accessToken) => set({ user, accessToken, status: 'authenticated' }),
  setUser: (user) => set({ user }),
  setToken: (accessToken) => set({ accessToken }),
  clear: () => set({ user: null, accessToken: null, status: 'anonymous' }),
}));

export const hasPermission = (user: AuthUser | null, permission: Permission) => !!user?.permissions.includes(permission);

export const usePermissions = () => {
  const user = useAuthStore((s) => s.user);
  return {
    user,
    can: (p: Permission) => hasPermission(user, p),
    canAny: (...ps: Permission[]) => ps.some((p) => hasPermission(user, p)),
    canAll: (...ps: Permission[]) => ps.every((p) => hasPermission(user, p)),
    // A team needs an employee profile: admin-only logins (no employee record) have no reports, whatever their permissions.
    isManager: !!user?.employeeId && (!!user?.isManager || hasPermission(user, 'team:view')),
    hasEmployee: !!user?.employeeId,
  };
};
