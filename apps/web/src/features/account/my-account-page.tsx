import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Bell, Building2, Camera, ChevronRight, KeyRound, LogOut, Mail, MessageSquareWarning, Palette, ShieldCheck, User, UserCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Avatar, Badge, Card, IconTitle, PageHeader } from '@/components/ui/display';
import { useLogout } from '@/features/auth/use-auth';
import { useChangeAvatar } from '@/layouts/avatar-camera';
import { cn } from '@/lib/utils';
import { useAuthStore, usePermissions } from '@/store/auth';

const Row = ({ to, icon, tone, title, sub }: { to: string; icon: ReactNode; tone: string; title: string; sub: string }) => (
  <li>
    <Link to={to} className="flex items-center gap-3 px-5 py-3.5 hover:bg-surface-2">
      <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', tone)} aria-hidden>
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-fg">{title}</span>
        <span className="block truncate text-xs text-muted">{sub}</span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted" aria-hidden />
    </Link>
  </li>
);

/** My account: who I'm signed in as, and shortcuts to my profile, password, security, notifications and theme. */
export const MyAccountPage = () => {
  const user = useAuthStore((s) => s.user);
  const { canAny } = usePermissions();
  const logout = useLogout();
  const photo = useChangeAvatar();
  const name = `${user?.firstName ?? ''} ${user?.lastName ?? ''}`.trim() || 'User';

  return (
    <>
      <PageHeader title={<IconTitle icon={<UserCircle />}>My account</IconTitle>} description="Your sign-in details and account settings." />

      <div className="grid max-w-4xl gap-4">
        <Card className="flex flex-wrap items-center gap-5 p-5">
          <Avatar name={name} src={user?.avatar} size="xl" />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-xl font-semibold text-fg">{name}</h2>
            <p className="mt-0.5 flex items-center gap-1.5 text-sm text-fg-2">
              <Mail className="h-4 w-4 text-muted" aria-hidden />
              <span className="truncate">{user?.email}</span>
            </p>
            {user?.organization?.name ? (
              <p className="mt-0.5 flex items-center gap-1.5 text-sm text-fg-2">
                <Building2 className="h-4 w-4 text-muted" aria-hidden />
                {user.organization.name}
              </p>
            ) : null}
            <div className="mt-2 flex flex-wrap gap-1.5">
              {user?.roles.map((r) => (
                <Badge key={r._id} tone="brand">
                  {r.name}
                </Badge>
              ))}
            </div>
          </div>
          <Button variant="outline" icon={<Camera className="h-4 w-4" />} loading={photo.busy} onClick={photo.open}>
            {user?.avatar ? 'Change photo' : 'Add a photo'}
          </Button>
          {photo.picker}
        </Card>

        <Card className="overflow-hidden">
          <ul className="divide-y divide-line">
            {user?.employeeId ? <Row to="/profile" icon={<User className="h-5 w-5" />} tone="bg-sky-100 text-sky-600 dark:bg-sky-500/15 dark:text-sky-300" title="My profile" sub="Personal, job and bank details" /> : null}
            <Row to="/change-password" icon={<KeyRound className="h-5 w-5" />} tone="bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300" title="Change password" sub="Update the password you sign in with" />
            <Row to="/settings/security" icon={<ShieldCheck className="h-5 w-5" />} tone="bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300" title="Security" sub="Signed-in devices and sessions" />
            <Row to="/settings/notifications" icon={<Bell className="h-5 w-5" />} tone="bg-violet-100 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300" title="Notifications" sub="What you are notified about and how" />
            <Row
              to="/complaints"
              icon={<MessageSquareWarning className="h-5 w-5" />}
              tone="bg-rose-100 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300"
              title="Complaints"
              sub={canAny('employee:update') ? 'Review and resolve employee complaints, or raise your own' : 'Raise a complaint with HR and track it'}
            />
            <Row to="/settings/appearance" icon={<Palette className="h-5 w-5" />} tone="bg-pink-100 text-pink-600 dark:bg-pink-500/15 dark:text-pink-300" title="Appearance" sub="Colour theme and language" />
          </ul>
        </Card>

        <div>
          <Button variant="danger" icon={<LogOut className="h-4 w-4" />} loading={logout.isPending} onClick={() => logout.mutate()}>
            Sign out
          </Button>
        </div>
      </div>
    </>
  );
};
