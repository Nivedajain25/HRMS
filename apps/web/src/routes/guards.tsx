import type { ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import type { Permission } from '@stencil/shared';
import { Logomark } from '@/components/common/brand';
import { EmptyState } from '@/components/ui/display';
import { t } from '@/lib/i18n';
import { usePermissions, useAuthStore } from '@/store/auth';

export const FullScreenLoader = () => (
  <div className="flex h-full items-center justify-center" role="status" aria-label="Loading">
    <Logomark className="h-10 w-10 animate-pulse" />
  </div>
);

/** Requires an authenticated session; otherwise redirects to /login. */
export const RequireAuth = () => {
  const status = useAuthStore((s) => s.status);
  const location = useLocation();
  if (status === 'loading') return <FullScreenLoader />;
  if (status === 'anonymous') return <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />;
  return <Outlet />;
};

/** Redirects signed-in users away from auth pages. */
export const GuestOnly = () => {
  const status = useAuthStore((s) => s.status);
  if (status === 'loading') return <FullScreenLoader />;
  if (status === 'authenticated') return <Navigate to="/" replace />;
  return <Outlet />;
};

export const Forbidden = () => (
  <EmptyState icon={<ShieldAlert className="h-6 w-6" />} title="Access denied" description={t('errors.forbidden')} className="card mt-10" />
);

/**
 * Frontend permission guard. The API enforces the same rules; this only keeps
 * users from landing on pages they cannot use.
 */
export const RequirePermission = ({
  any,
  manager,
  employee,
  children,
}: {
  any?: Permission[];
  manager?: boolean;
  employee?: boolean;
  children: ReactNode;
}) => {
  const { canAny, isManager, hasEmployee } = usePermissions();
  const allowed = (any?.length ? canAny(...any) : false) || (manager && isManager) || (employee && hasEmployee) || (!any?.length && !manager && !employee);
  return allowed ? <>{children}</> : <Forbidden />;
};
