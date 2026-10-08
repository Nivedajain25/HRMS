import { lazy, Suspense, type ComponentType } from 'react';
import { Navigate, NavLink, useParams } from 'react-router-dom';
import {
  Bell,
  Building2,
  ClipboardList,
  KeyRound,
  Mail,
  Palette,
  Plug,
  ScrollText,
  ShieldCheck,
  SlidersHorizontal,
  UserCog,
  type LucideIcon,
} from 'lucide-react';
import type { Permission } from '@stencil/shared';
import { PageHeader, Skeleton } from '@/components/ui/display';
import { Select } from '@/components/ui/input';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { usePermissions } from '@/store/auth';

interface Section {
  key: string;
  label: string;
  description: string;
  icon: LucideIcon;
  permission?: Permission;
  component: ComponentType;
}

const load = <K extends string>(loader: () => Promise<Record<K, ComponentType>>, name: K) => lazy(() => loader().then((m) => ({ default: m[name] })));
const admin = () => import('./sections/admin-sections');
const policy = () => import('./sections/policy-sections');
const personal = () => import('./sections/personal-sections');

const SECTIONS: Section[] = [
  { key: 'organization', label: 'Organization', description: 'Company profile, locale and fiscal settings.', icon: Building2, permission: 'settings:manage', component: load(admin, 'OrganizationSection') },
  { key: 'users', label: 'Users', description: 'Accounts, invitations and access.', icon: UserCog, permission: 'user:manage', component: load(admin, 'UsersSection') },
  { key: 'roles', label: 'Roles & Permissions', description: 'System and custom roles.', icon: KeyRound, permission: 'role:manage', component: load(admin, 'RolesSection') },
  { key: 'attendance', label: 'Attendance', description: 'Check-in rules, overtime and absence marking.', icon: ClipboardList, permission: 'settings:manage', component: load(policy, 'AttendanceSettingsSection') },
  { key: 'leave', label: 'Leave', description: 'Balances and backdating rules.', icon: ClipboardList, permission: 'settings:manage', component: load(policy, 'LeaveSettingsSection') },
  { key: 'payroll', label: 'Payroll', description: 'Pay day, basis and rule packs.', icon: SlidersHorizontal, permission: 'settings:manage', component: load(policy, 'PayrollSettingsSection') },
  { key: 'approvals', label: 'Approvals', description: 'Approval chains for leave, regularization and expenses.', icon: ShieldCheck, permission: 'settings:manage', component: load(policy, 'ApprovalSettingsSection') },
  { key: 'identity', label: 'Employee fields', description: 'Identity documents collected per employee.', icon: ClipboardList, permission: 'settings:manage', component: load(policy, 'IdentityFieldsSection') },
  { key: 'notifications', label: 'Notifications', description: 'What you are notified about and how.', icon: Bell, component: load(personal, 'NotificationPreferencesSection') },
  { key: 'email', label: 'Email', description: 'Outgoing email delivery.', icon: Mail, permission: 'settings:manage', component: load(policy, 'EmailSection') },
  { key: 'security', label: 'Security', description: 'Sessions and sign-in protection.', icon: ShieldCheck, component: load(personal, 'SecuritySection') },
  { key: 'audit', label: 'Audit log', description: 'Every important change, who made it and when.', icon: ScrollText, permission: 'audit:read', component: load(admin, 'AuditLogSection') },
  { key: 'integrations', label: 'Integrations', description: 'Connect other systems.', icon: Plug, permission: 'settings:manage', component: load(policy, 'IntegrationsSection') },
  { key: 'appearance', label: 'Appearance', description: 'Theme and language.', icon: Palette, component: load(personal, 'AppearanceSection') },
];

export const SettingsPage = () => {
  const { section } = useParams();
  const { can } = usePermissions();
  const navigate = useNavigate();
  const visible = SECTIONS.filter((s) => !s.permission || can(s.permission));
  const current = visible.find((s) => s.key === section);
  if (!current) return <Navigate to={`/settings/${visible[0]?.key ?? 'appearance'}`} replace />;
  const Component = current.component;

  return (
    <>
      <PageHeader title="Settings" description="Manage your organization and personal preferences." />
      <div className="grid gap-6 lg:grid-cols-[240px_1fr]">
        <div className="lg:hidden">
          <label htmlFor="settings-section" className="sr-only">
            Settings section
          </label>
          <Select id="settings-section" value={current.key} onChange={(e) => navigate(`/settings/${e.target.value}`)} options={visible.map((s) => ({ value: s.key, label: s.label }))} />
        </div>
        <nav aria-label="Settings sections" className="hidden lg:block">
          <ul className="space-y-0.5">
            {visible.map(({ key, label, icon: Icon }) => (
              <li key={key}>
                <NavLink
                  to={`/settings/${key}`}
                  className={({ isActive }) =>
                    cn('flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium', isActive ? 'bg-surface text-fg shadow-card ring-1 ring-line' : 'text-muted hover:bg-surface-3 hover:text-fg')
                  }
                >
                  <Icon className="h-4 w-4" />
                  {label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <section aria-labelledby="settings-title" className="min-w-0">
          <div className="mb-4">
            <h2 id="settings-title" className="text-lg font-semibold text-fg">
              {current.label}
            </h2>
            <p className="text-sm text-muted">{current.description}</p>
          </div>
          <Suspense fallback={<Skeleton className="h-72" />}>
            <Component />
          </Suspense>
        </section>
      </div>
    </>
  );
};
