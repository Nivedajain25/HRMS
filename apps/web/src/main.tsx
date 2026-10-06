import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster, toast } from 'sonner';
import { ConfirmProvider } from '@/components/ui/overlay';
import { useBootstrapSession } from '@/features/auth/use-auth';
import { ApiError } from '@/lib/api';
import { router } from '@/routes/router';
import { useThemeStore, watchSystemTheme } from '@/store/theme';
import '@/styles/index.css';

const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error, query) => {
      // Background refetch failures surface as toasts; initial loads show inline error states.
      if (query.state.data !== undefined && error instanceof ApiError && error.status !== 401) toast.error(error.message);
    },
  }),
  mutationCache: new MutationCache({
    onError: (error, _vars, _ctx, mutation) => {
      if (mutation.options.meta?.silent) return;
      if (error instanceof ApiError && error.status !== 401 && error.code !== 'VALIDATION_ERROR') toast.error(error.message);
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (count, error) => !(error instanceof ApiError && error.status >= 400 && error.status < 500) && count < 2,
      refetchOnWindowFocus: false,
    },
  },
});

declare module '@tanstack/react-query' {
  interface Register {
    mutationMeta: { silent?: boolean };
  }
}

const App = () => {
  useBootstrapSession();
  const theme = useThemeStore((s) => s.theme);
  useEffect(() => watchSystemTheme(), []);
  return (
    <QueryClientProvider client={queryClient}>
      <ConfirmProvider>
        <RouterProvider router={router} />
      </ConfirmProvider>
      <Toaster position="top-right" richColors closeButton theme={theme} />
    </QueryClientProvider>
  );
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
