import { AppState, Platform, type AppStateStatus } from 'react-native';
import { focusManager, MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { ApiError } from './api';

/** Errors that will not go away by retrying the same request. */
const isPermanent = (err: unknown) =>
  err instanceof ApiError && err.status >= 400 && err.status < 500 && err.status !== 408 && err.status !== 429;

export const queryClient = new QueryClient({
  queryCache: new QueryCache(),
  mutationCache: new MutationCache(),
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 10 * 60_000,
      retry: (count, err) => !isPermanent(err) && count < 2,
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
    },
    mutations: { retry: false },
  },
});

/** Maps app foreground/background to React Query's focus state (refetch stale queries on resume). */
export const subscribeAppFocus = () => {
  const onChange = (status: AppStateStatus) => {
    if (Platform.OS !== 'web') focusManager.setFocused(status === 'active');
  };
  const sub = AppState.addEventListener('change', onChange);
  return () => sub.remove();
};
