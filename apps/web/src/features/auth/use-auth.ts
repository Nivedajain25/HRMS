import { useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import type { AuthSession } from '@stencil/types';
import type { LoginInput, RegisterInput } from '@stencil/shared';
import { api, post, refreshSession } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { useThemeStore } from '@/store/theme';

/** Restores the session from the refresh cookie on app start. */
export const useBootstrapSession = () => {
  const status = useAuthStore((s) => s.status);
  useEffect(() => {
    if (status !== 'loading') return;
    void refreshSession().then((session) => {
      if (!session) useAuthStore.getState().clear();
    });
  }, [status]);
  return status;
};

/** Applies the server-side theme preference after sign-in. */
const syncTheme = (session: AuthSession) => {
  const pref = session.user.preferences?.theme;
  if (pref && pref !== useThemeStore.getState().theme) useThemeStore.getState().setTheme(pref);
};

export const useLogin = () => {
  const setSession = useAuthStore((s) => s.setSession);
  return useMutation({
    mutationFn: (input: LoginInput) => post<AuthSession>('/auth/login', input),
    onSuccess: ({ data }) => {
      setSession(data.user, data.accessToken);
      syncTheme(data);
    },
  });
};

export const useRegister = () => {
  const setSession = useAuthStore((s) => s.setSession);
  return useMutation({
    mutationFn: (input: RegisterInput) => post<AuthSession>('/auth/register', input),
    onSuccess: ({ data }) => setSession(data.user, data.accessToken),
  });
};

export const useLogout = () => {
  const clear = useAuthStore((s) => s.clear);
  const qc = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: () => api.post('/auth/logout'),
    onSettled: () => {
      clear();
      qc.clear();
      navigate('/login', { replace: true });
      toast.success('Signed out');
    },
  });
};

/** Reloads the current user (after profile/role changes). */
export const useRefreshMe = () => {
  const setUser = useAuthStore((s) => s.setUser);
  return async () => {
    const res = await api.get<{ data: AuthSession['user'] }>('/auth/me');
    setUser(res.data.data);
  };
};
