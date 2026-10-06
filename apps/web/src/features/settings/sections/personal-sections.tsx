import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { LogOut, Moon, Smartphone, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, ErrorState, Skeleton } from '@/components/ui/display';
import { Select, Switch } from '@/components/ui/input';
import { useConfirm } from '@/components/ui/overlay';
import { api, del, get, patch, put } from '@/lib/api';
import { label } from '@/lib/i18n';
import { cn, formatDateTime, timeAgo } from '@/lib/utils';
import { useAuthStore, usePermissions } from '@/store/auth';
import { useThemeStore, type ThemePreference } from '@/store/theme';
import { SecurityPolicySection } from './policy-sections';

interface Preference {
  type: string;
  inApp: boolean;
  email: boolean;
}

export const NotificationPreferencesSection = () => {
  const prefs = useQuery({ queryKey: ['notifications', 'preferences'], queryFn: () => get<Preference[]>('/notifications/preferences') });
  const [rows, setRows] = useState<Preference[]>([]);
  const qc = useQueryClient();
  useEffect(() => {
    if (prefs.data) setRows(prefs.data);
  }, [prefs.data]);
  const save = useMutation({
    mutationFn: () => put('/notifications/preferences', { preferences: rows }),
    onSuccess: async () => {
      toast.success('Preferences saved');
      await qc.invalidateQueries({ queryKey: ['notifications', 'preferences'] });
    },
  });
  if (prefs.isLoading) return <Skeleton className="h-80" />;
  if (prefs.error) return <ErrorState message={prefs.error.message} onRetry={() => prefs.refetch()} />;
  const setRow = (i: number, patchRow: Partial<Preference>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patchRow } : x)));
  return (
    <Card>
      <div className="scrollbar-thin overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">Notification preferences</caption>
          <thead className="bg-surface-2 text-xs text-muted uppercase">
            <tr>
              <th scope="col" className="px-5 py-2.5 text-left font-semibold">Notification</th>
              <th scope="col" className="px-5 py-2.5 text-center font-semibold">In-app</th>
              <th scope="col" className="px-5 py-2.5 text-center font-semibold">Email</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((p, i) => (
              <tr key={p.type}>
                <td className="px-5 py-3 text-fg">{label(p.type)}</td>
                <td className="px-5 py-3 text-center"><Switch checked={p.inApp} label={`${label(p.type)} in-app`} onChange={(inApp) => setRow(i, { inApp })} /></td>
                <td className="px-5 py-3 text-center"><Switch checked={p.email} label={`${label(p.type)} email`} onChange={(email) => setRow(i, { email })} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex justify-end border-t border-line bg-surface-2 px-5 py-3">
        <Button onClick={() => save.mutate()} loading={save.isPending}>
          Save preferences
        </Button>
      </div>
    </Card>
  );
};

interface SessionRow {
  _id: string;
  ipAddress?: string;
  userAgent?: string;
  createdAt: string;
  lastUsedAt?: string;
  expiresAt: string;
  rememberMe: boolean;
}

const deviceName = (ua?: string) => {
  if (!ua) return 'Unknown device';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'macOS' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Linux/.test(ua) ? 'Linux' : '';
  return `${browser}${os ? ` on ${os}` : ''}`;
};

export const SecuritySection = () => {
  const sessions = useQuery({ queryKey: ['auth', 'sessions'], queryFn: () => get<SessionRow[]>('/auth/sessions') });
  const qc = useQueryClient();
  const confirm = useConfirm();
  const clear = useAuthStore((s) => s.clear);
  const { can } = usePermissions();
  const revoke = useMutation({ mutationFn: (id: string) => del(`/auth/sessions/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ['auth', 'sessions'] }) });
  const logoutAll = async () => {
    const { confirmed } = await confirm({ title: 'Sign out of all devices?', message: 'Every session, including this one, will be ended.', confirmLabel: 'Sign out everywhere' });
    if (!confirmed) return;
    await api.post('/auth/logout-all');
    clear();
    qc.clear();
  };
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="Active sessions" description="Devices currently signed in to your account." actions={<Button variant="outline" size="sm" icon={<LogOut className="h-4 w-4" />} onClick={logoutAll}>Sign out everywhere</Button>} />
        {sessions.isLoading ? (
          <CardBody><Skeleton className="h-24" /></CardBody>
        ) : sessions.error ? (
          <ErrorState message={sessions.error.message} onRetry={() => sessions.refetch()} />
        ) : (
          <ul className="divide-y divide-line">
            {sessions.data?.map((s) => (
              <li key={s._id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                <span className="flex items-center gap-3">
                  <Smartphone className="h-5 w-5 text-muted" />
                  <span>
                    <span className="block text-sm font-medium text-fg">{deviceName(s.userAgent)}</span>
                    <span className="block text-xs text-muted">
                      {s.ipAddress ?? 'Unknown IP'} · signed in {formatDateTime(s.createdAt)} · active {timeAgo(s.lastUsedAt ?? s.createdAt)}
                    </span>
                  </span>
                </span>
                <Button variant="ghost" size="sm" onClick={() => revoke.mutate(s._id)} loading={revoke.isPending && revoke.variables === s._id}>
                  Revoke
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {can('settings:manage') && (
        <div>
          <h3 className="mb-3 text-sm font-semibold text-fg">Organization sign-in policy</h3>
          <SecurityPolicySection />
        </div>
      )}
    </div>
  );
};

export const AppearanceSection = () => {
  const { theme, setTheme } = useThemeStore();
  const save = useMutation({ mutationFn: (t: ThemePreference) => patch('/users/me/preferences', { theme: t }) });
  const choose = (t: ThemePreference) => {
    setTheme(t);
    save.mutate(t);
  };
  const options: { value: ThemePreference; label: string; icon: typeof Sun }[] = [
    { value: 'light', label: 'Light', icon: Sun },
    { value: 'dark', label: 'Dark', icon: Moon },
  ];
  return (
    <Card>
      <CardBody className="space-y-6">
        <fieldset>
          <legend className="mb-3 text-sm font-medium text-fg">Theme</legend>
          <div className="grid max-w-sm grid-cols-2 gap-3" role="radiogroup">
            {options.map(({ value, label: text, icon: Icon }) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={theme === value}
                onClick={() => choose(value)}
                className={cn('flex flex-col items-center gap-2 rounded-xl border p-4 text-sm font-medium', theme === value ? 'border-brand-600 bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300' : 'border-line text-fg-2 hover:bg-surface-2')}
              >
                <Icon className="h-5 w-5" />
                {text}
              </button>
            ))}
          </div>
        </fieldset>
        <div className="max-w-xs">
          <label htmlFor="language" className="mb-1.5 block text-sm font-medium text-fg">Language</label>
          <Select id="language" value="en" onChange={() => undefined} options={[{ value: 'en', label: 'English' }]} />
          <p className="mt-1 text-xs text-muted">More languages coming soon.</p>
        </div>
      </CardBody>
    </Card>
  );
};
