import { Suspense, useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bell,
  CalendarCheck,
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Home,
  KeyRound,
  Camera,
  LogOut,
  Menu,
  Moon,
  Search,
  Sun,
  User,
  Wallet,
  X,
} from 'lucide-react';
import { NAVIGATION, isAllowed, type NavGroup } from '@/app/navigation';
import { Logo } from '@/components/common/brand';
import { GlobalSearch } from '@/components/common/global-search';
import { Button } from '@/components/ui/button';
import { Avatar, PageSkeleton } from '@/components/ui/display';
import { Dropdown } from '@/components/ui/overlay';
import { AvatarCameraBadge, useChangeAvatar } from './avatar-camera';
import { get, patch, post } from '@/lib/api';
import { cn, timeAgo } from '@/lib/utils';
import { TONE_TEXT } from '@/lib/module-colors';
import { useLogout } from '@/features/auth/use-auth';
import { AnnouncementBar, AnnouncementPopup } from '@/features/announcements/components/announcement-highlights';
import { EmergencyAlerts } from '@/features/emergencies/components/emergency-alerts';
import { EmergencyButton } from '@/features/emergencies/components/emergency-button';
import { MyEmergencyStatus } from '@/features/emergencies/components/my-emergency-status';
import { TaskPopup } from '@/features/tasks/components/task-popup';
import { dashboardKind } from '@/features/dashboard/lib';
import { TeamMenu } from './team-menu';
import { usePermissions } from '@/store/auth';
import { useThemeStore, type ThemePreference } from '@/store/theme';

const SidebarNav = ({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) => {
  const { user, isManager, hasEmployee } = usePermissions();
  const location = useLocation();
  const perms = user?.permissions ?? [];
  const groups = NAVIGATION.filter((g) => isAllowed(g, perms, isManager, hasEmployee))
    .map((g) => ({ ...g, children: g.children?.filter((c) => isAllowed(c, perms, isManager, hasEmployee)) }))
    .filter((g) => g.to || g.children?.length);

  const activeGroup = (g: NavGroup) => g.children?.some((c) => location.pathname === c.to || location.pathname.startsWith(`${c.to}/`));
  const [open, setOpen] = useState<Record<string, boolean>>({});

  return (
    <nav aria-label="Main navigation" className="scrollbar-thin relative flex-1 space-y-0.5 overflow-y-auto px-2.5 py-2.5">
      {groups.map((g) => {
        const Icon = g.icon;
        if (g.to) {
          return (
            <NavLink
              key={g.label}
              to={g.to}
              end={g.to === '/'}
              onClick={onNavigate}
              title={collapsed ? g.label : undefined}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm font-medium transition-colors',
                  isActive ? 'bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300' : 'text-fg-2 hover:bg-surface-3 hover:text-fg',
                  collapsed && 'justify-center',
                )
              }
            >
              <Icon className={cn('nav-icon h-[18px] w-[18px] shrink-0', TONE_TEXT[g.tone])} />
              {!collapsed && g.label}
            </NavLink>
          );
        }
        const isOpen = open[g.label] ?? activeGroup(g) ?? false;
        return (
          <div key={g.label}>
            <button
              type="button"
              onClick={() => setOpen((o) => ({ ...o, [g.label]: !isOpen }))}
              aria-expanded={isOpen}
              title={collapsed ? g.label : undefined}
              className={cn(
                'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm font-medium transition-colors',
                activeGroup(g) ? 'text-fg' : 'text-fg-2 hover:bg-surface-3 hover:text-fg',
                collapsed && 'justify-center',
              )}
            >
              <Icon className={cn('nav-icon h-[18px] w-[18px] shrink-0', TONE_TEXT[g.tone])} />
              {!collapsed && (
                <>
                  <span className="flex-1 text-left">{g.label}</span>
                  <ChevronDown className={cn('h-4 w-4 text-subtle transition-transform', isOpen && 'rotate-180')} />
                </>
              )}
            </button>
            {isOpen && !collapsed && (
              <div className="mt-0.5 mb-1 ml-[19px] space-y-0.5 border-l border-line pl-2.5">
                {g.children!.map((c) => (
                  <NavLink
                    key={c.to}
                    to={c.to}
                    end
                    onClick={onNavigate}
                    className={({ isActive }) =>
                      cn(
                        'flex items-center gap-2.5 rounded-md px-2.5 py-1 text-[13px] transition-colors',
                        isActive ? 'bg-brand-50 font-medium text-brand-700 dark:bg-brand-500/15 dark:text-brand-300' : 'text-muted hover:bg-surface-3 hover:text-fg',
                      )
                    }
                  >
                    <c.icon className={cn('nav-icon h-4 w-4 shrink-0', TONE_TEXT[c.tone ?? g.tone])} aria-hidden />
                    {c.label}
                  </NavLink>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
};

interface NotificationItem {
  _id: string;
  title: string;
  message: string;
  link?: string;
  readAt?: string | null;
  createdAt: string;
}

const NotificationBell = () => {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const count = useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: () => get<{ count: number }>('/notifications/unread-count'),
    refetchInterval: 60_000,
  });
  const list = useQuery({
    queryKey: ['notifications', 'recent'],
    queryFn: () => get<NotificationItem[]>('/notifications', { limit: 8 }),
    enabled: open,
  });
  const markAll = useMutation({
    mutationFn: () => post('/notifications/read-all'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
  const markOne = useMutation({
    mutationFn: (id: string) => post(`/notifications/${id}/read`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
  const unread = count.data?.count ?? 0;

  useEffect(() => {
    if (!open) return;
    const close = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [open]);

  return (
    <div className="relative">
      <Button variant="ghost" size="icon" aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Bell className="h-5 w-5" />
        {unread > 0 && (
          <span className="absolute top-1 right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </Button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} aria-hidden />
          <div className="animate-scale-in absolute right-0 z-40 mt-2 w-[min(92vw,380px)] overflow-hidden rounded-xl border border-line bg-surface shadow-pop">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <h2 className="text-sm font-semibold">Notifications</h2>
              {unread > 0 && (
                <Button variant="link" size="xs" onClick={() => markAll.mutate()}>
                  Mark all read
                </Button>
              )}
            </div>
            <ul className="scrollbar-thin max-h-96 divide-y divide-line overflow-y-auto">
              {list.isLoading && <li className="px-4 py-6 text-center text-sm text-muted">Loading…</li>}
              {list.data?.length === 0 && <li className="px-4 py-8 text-center text-sm text-muted">You're all caught up.</li>}
              {list.data?.map((n) => (
                <li key={n._id}>
                  <button
                    type="button"
                    className={cn('flex w-full gap-3 px-4 py-3 text-left hover:bg-surface-2', !n.readAt && 'bg-brand-50/50 dark:bg-brand-500/5')}
                    onClick={() => {
                      if (!n.readAt) markOne.mutate(n._id);
                      setOpen(false);
                      if (n.link) navigate(n.link);
                    }}
                  >
                    <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', n.readAt ? 'bg-transparent' : 'bg-brand-600')} aria-hidden />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-fg">{n.title}</span>
                      <span className="line-clamp-2 block text-xs text-muted">{n.message}</span>
                      <span className="mt-1 block text-[11px] text-subtle">{timeAgo(n.createdAt)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <Link to="/notifications" onClick={() => setOpen(false)} className="block border-t border-line px-4 py-2.5 text-center text-sm font-medium text-brand-600 hover:bg-surface-2 dark:text-brand-400">
              View all
            </Link>
          </div>
        </>
      )}
    </div>
  );
};

const ThemeToggle = () => {
  const { theme, setTheme } = useThemeStore();
  const qc = useQueryClient();
  const persist = (t: ThemePreference) => {
    setTheme(t);
    // Also save the preference on the user profile (best effort).
    void api_savePref(t).then(() => qc.invalidateQueries({ queryKey: ['me'] }));
  };
  // Older "system" preferences show whichever theme is actually in use.
  const dark = theme === 'dark' || (theme === 'system' && document.documentElement.classList.contains('dark'));
  // Sun / moon flip: both icons are stacked; switching spins one out and the other in while the page fades.
  const flip = 'absolute h-5 w-5 transition-all duration-700 ease-[cubic-bezier(0.34,1.56,0.64,1)] motion-reduce:transition-none';
  // One click toggles light ⇄ dark.
  return (
    <button
      type="button"
      onClick={() => persist(dark ? 'light' : 'dark')}
      aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      className="relative inline-flex h-9 w-9 items-center justify-center overflow-hidden rounded-lg text-fg-2 hover:bg-surface-3 focus-visible:outline-2 focus-visible:outline-brand-500"
    >
      <Sun className={cn(flip, 'text-amber-500', dark ? '-rotate-180 scale-0 opacity-0' : 'rotate-0 scale-100 opacity-100')} aria-hidden />
      <Moon className={cn(flip, 'text-indigo-300', dark ? 'rotate-0 scale-100 opacity-100' : 'rotate-180 scale-0 opacity-0')} aria-hidden />
    </button>
  );
};
const api_savePref = (theme: ThemePreference) => patch('/users/me/preferences', { theme }).catch(() => undefined);

const MobileTabBar = () => {
  const items = [
    { to: '/', label: 'Home', icon: Home, end: true },
    { to: '/attendance', label: 'Attendance', icon: CalendarCheck },
    { to: '/leave', label: 'Leave', icon: CalendarDays },
    { to: '/payslips', label: 'Payslips', icon: Wallet },
    { to: '/profile', label: 'Profile', icon: User },
  ];
  return (
    <nav aria-label="Quick navigation" className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
      <ul className="grid grid-cols-5">
        {items.map(({ to, label, icon: Icon, end }) => (
          <li key={to}>
            <NavLink
              to={to}
              end={end}
              className={({ isActive }) => cn('flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium', isActive ? 'text-brand-600 dark:text-brand-400' : 'text-muted')}
            >
              <Icon className="h-5 w-5" />
              {label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
};

export const AppLayout = () => {
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('sidebar-collapsed') === '1');
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const { user } = usePermissions();
  const logout = useLogout();
  const photo = useChangeAvatar();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => setMobileOpen(false), [location.pathname]);
  useEffect(() => {
    try {
      localStorage.setItem('sidebar-collapsed', collapsed ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, [collapsed]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const name = `${user?.firstName ?? ''} ${user?.lastName ?? ''}`.trim();
  // Sidebar and top bar: the same white look for every role, with a subtle role accent (styles/index.css):
  // Super Admin and HR violet, Employee blue.
  const kind = dashboardKind(user?.roles);
  // HR shares the super admin's violet chrome.
  const chrome = kind === 'employee' ? 'chrome-wine' : 'chrome-indigo';

  return (
    // `relative overflow-hidden` + `relative` on the scroll areas: absolutely positioned descendants (e.g. `sr-only`
    // labels deep in a page) stay inside their scroll container instead of stretching the document, which made the
    // whole window scroll and left an empty strip below the app.
    <div className="relative flex h-full overflow-hidden">
      <a href="#main" className="sr-only z-50 rounded bg-brand-600 px-3 py-2 text-white focus:not-sr-only focus:fixed focus:top-2 focus:left-2">
        Skip to content
      </a>
      {/* Desktop sidebar */}
      <aside className={cn('relative z-30 hidden shrink-0 flex-col border-r border-line bg-surface transition-[width] lg:flex', collapsed ? 'w-[68px]' : 'w-56', chrome)}>
        <div className={cn('flex h-16 items-center border-b border-line', collapsed ? 'justify-center' : 'px-4')}>
          <Link to="/" aria-label="Stencil HRMS home" className="min-w-0">
            <Logo collapsed={collapsed} size="sm" />
          </Link>
          {/*
            Expand / minimise (every role): a round Stencil-blue button sitting on the sidebar's right edge, halfway
            down — ‹ minimise, › expand.
          */}
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            aria-label={collapsed ? 'Expand sidebar' : 'Minimise sidebar'}
            title={collapsed ? 'Expand sidebar' : 'Minimise sidebar'}
            aria-expanded={!collapsed}
            className="absolute top-1/2 -right-4 z-30 flex -translate-y-1/2 h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 border-canvas bg-[#24478f] text-white shadow-sm ring-1 ring-[#24478f]/20 transition-colors hover:bg-[#12326e] dark:bg-[#2a4fa0] dark:hover:bg-[#3560b8]"
          >
            {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </button>
        </div>
        <SidebarNav collapsed={collapsed} />
      </aside>

      {/* Mobile sidebar */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="animate-fade-in absolute inset-0 bg-slate-950/50" onClick={() => setMobileOpen(false)} aria-hidden />
          <aside className={cn('animate-slide-in-right absolute inset-y-0 left-0 flex w-72 flex-col bg-surface shadow-pop', chrome)} style={{ animationName: 'none' }}>
            <div className="flex h-16 items-center justify-between border-b border-line px-4">
              <Logo />
              <Button variant="ghost" size="icon-sm" onClick={() => setMobileOpen(false)} aria-label="Close menu">
                <X className="h-5 w-5" />
              </Button>
            </div>
            <SidebarNav collapsed={false} onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className={cn('sticky top-0 z-20 flex h-16 shrink-0 items-center gap-3 border-b border-line bg-surface/90 px-4 backdrop-blur sm:px-6', chrome)}>
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open menu">
            <Menu className="h-5 w-5" />
          </Button>
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            className="flex h-9 w-full max-w-md items-center gap-2 rounded-lg border border-line bg-surface-2 px-3 text-sm text-muted hover:border-line-strong"
          >
            <Search className="h-4 w-4 shrink-0" />
            <span className="flex-1 truncate text-left">
              <span className="sm:hidden">Search…</span>
              <span className="hidden sm:inline">Search people, assets, documents…</span>
            </span>
            <kbd className="hidden rounded border border-line bg-surface px-1.5 text-[10px] font-medium sm:inline">Ctrl K</kbd>
          </button>
          <div className="ml-auto flex items-center gap-1">
            <EmergencyButton />
            <ThemeToggle />
            <TeamMenu />
            <NotificationBell />
            <div className="relative">
            {photo.picker}
            <Dropdown
              label="Account menu"
              trigger={
                <span className="flex items-center gap-2 rounded-lg py-1 pr-1 pl-1 hover:bg-surface-3 sm:pr-2">
                  <Avatar name={name || 'User'} src={user?.avatar} size="sm" />
                  <span className="hidden text-left sm:block">
                    <span className="block text-sm leading-tight font-medium text-fg">{name}</span>
                    <span className="block text-xs leading-tight text-muted">{user?.roles[0]?.name}</span>
                  </span>
                </span>
              }
              items={[
                { label: user?.avatar ? 'Change photo' : 'Add a photo', icon: <Camera className="h-4 w-4" />, onSelect: photo.open },
                { label: 'My profile', icon: <User className="h-4 w-4" />, onSelect: () => navigate('/profile'), hidden: !user?.employeeId },
                { label: 'Change password', icon: <KeyRound className="h-4 w-4" />, onSelect: () => navigate('/change-password') },
                { label: 'Sign out', icon: <LogOut className="h-4 w-4" />, onSelect: () => logout.mutate(), danger: true },
              ]}
            />
            {/* Camera badge on the avatar's corner (outside the menu button, so it's its own control). */}
            <AvatarCameraBadge onClick={photo.open} busy={photo.busy} className="absolute top-[24px] left-[20px] h-4 w-4 [&_svg]:h-2.5 [&_svg]:w-2.5" />
            </div>
          </div>
        </header>
        <EmergencyAlerts />
        <MyEmergencyStatus />
        <AnnouncementBar />
        <main id="main" tabIndex={-1} className="relative flex-1 overflow-y-auto px-4 pt-6 pb-24 focus:outline-none sm:px-6 lg:px-8 lg:pb-10">
          <div className="mx-auto max-w-[1400px]">
            <Suspense fallback={<PageSkeleton />}>
              <Outlet />
            </Suspense>
          </div>
        </main>
      </div>
      {user?.employeeId && <MobileTabBar />}
      <GlobalSearch open={searchOpen} onClose={() => setSearchOpen(false)} />
      <AnnouncementPopup />
      <TaskPopup />
    </div>
  );
};
