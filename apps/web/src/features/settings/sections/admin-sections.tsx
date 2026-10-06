import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { toast } from 'sonner';
import type { z } from 'zod';
import { Copy, KeyRound, Link2, Lock, MailPlus, MoreHorizontal, Pencil, Plus, Trash2, Upload } from 'lucide-react';
import { AUDIT_ACTIONS, USER_STATUS, WEEKDAYS, organizationUpdateSchema, roleSchema, userCreateSchema } from '@stencil/shared';
import { Combobox, EmployeePicker, FilterBar, SearchInput } from '@/components/common/controls';
import { StatusBadge } from '@/components/common/status-badge';
import { applyServerErrors, FormError, FormField, FormGrid } from '@/components/forms/form';
import { DataTable } from '@/components/tables/data-table';
import { Button } from '@/components/ui/button';
import { Avatar, Badge, Card, CardBody, CardHeader, ErrorState, Skeleton } from '@/components/ui/display';
import { Checkbox, DateRangePicker, Input, Select, Textarea } from '@/components/ui/input';
import { Drawer, Dropdown, Modal, useConfirm } from '@/components/ui/overlay';
import { useListParams } from '@/hooks/use-list-params';
import { del, get, getPaged, patch, post, put, toApiError, upload } from '@/lib/api';
import { label } from '@/lib/i18n';
import { cn, formatDateTime, timeAgo } from '@/lib/utils';
import { useRefreshMe } from '@/features/auth/use-auth';
import { usePermissions } from '@/store/auth';

/* ---------------------------- Organization ---------------------------- */

type OrgValues = z.input<typeof organizationUpdateSchema>;
interface Organization extends OrgValues {
  _id: string;
  logo?: string | null;
}

const TIMEZONES = (() => {
  try {
    return (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? ['UTC'];
  } catch {
    return ['UTC'];
  }
})();
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export const OrganizationSection = () => {
  const qc = useQueryClient();
  const refreshMe = useRefreshMe();
  const org = useQuery({ queryKey: ['organization'], queryFn: () => get<Organization>('/organization') });
  const [serverError, setServerError] = useState<string | null>(null);
  const form = useForm<OrgValues>({ resolver: zodResolver(organizationUpdateSchema) });
  useEffect(() => {
    if (org.data) {
      const { _id: _ignored, logo: _logo, ...rest } = org.data;
      void _ignored;
      void _logo;
      form.reset({ ...rest, fiscalYearStart: org.data.fiscalYearStart ?? 1 });
    }
  }, [org.data, form]);
  const save = useMutation({ mutationFn: (v: OrgValues) => patch('/organization', v), meta: { silent: true } });
  const logo = useMutation({
    mutationFn: async (file: File) => {
      const res = await upload<{ _id: string }>('/files', file, { context: 'LOGO' });
      return patch('/organization', { logo: `/api/v1/files/${res.data._id}` });
    },
    onSuccess: async () => {
      toast.success('Logo updated');
      await qc.invalidateQueries({ queryKey: ['organization'] });
      await refreshMe();
    },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setServerError(null);
    const clean = Object.fromEntries(Object.entries(values).filter(([k, v]) => v !== '' && !['createdAt', 'updatedAt', 'slug', 'status', 'settings', 'weekends', 'employeeSequence', 'assetSequence', 'id'].includes(k)));
    try {
      await save.mutateAsync(clean as OrgValues);
      toast.success('Organization saved');
      await qc.invalidateQueries({ queryKey: ['organization'] });
      await refreshMe();
    } catch (err) {
      setServerError(applyServerErrors(toApiError(err), form.setError, Object.keys(organizationUpdateSchema.shape)));
    }
  });

  if (org.isLoading) return <Skeleton className="h-96" />;
  if (org.error) return <ErrorState message={org.error.message} onRetry={() => org.refetch()} />;
  const errors = form.formState.errors;
  const text = (name: keyof OrgValues, lbl: string, type = 'text') => (
    <FormField label={lbl} error={errors[name] as { message?: string }}>
      {({ id, invalid }) => <Input id={id} type={type} aria-invalid={invalid} {...form.register(name)} />}
    </FormField>
  );
  const workingDays = form.watch('workingDays') ?? [];

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-6">
      <FormError error={serverError} />
      <Card>
        <CardHeader title="Branding" />
        <CardBody className="flex items-center gap-4">
          <Avatar name={org.data?.name ?? 'Org'} src={org.data?.logo} size="lg" className="rounded-xl" />
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm font-medium shadow-sm hover:bg-surface-2">
            <Upload className="h-4 w-4" />
            {logo.isPending ? 'Uploading…' : 'Upload logo'}
            <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(e) => e.target.files?.[0] && logo.mutate(e.target.files[0])} />
          </label>
          <span className="text-xs text-muted">PNG, JPG or WebP</span>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Company details" />
        <CardBody className="space-y-4">
          <FormGrid>
            {text('name', 'Display name')}
            {text('legalName', 'Legal name')}
            {text('email', 'Email', 'email')}
            {text('phone', 'Phone', 'tel')}
            {text('website', 'Website')}
          </FormGrid>
          <FormField label="Address">{({ id }) => <Textarea id={id} rows={2} {...form.register('address')} />}</FormField>
          <FormGrid cols={3}>
            {text('city', 'City')}
            {text('state', 'State / Region')}
            {text('country', 'Country')}
            {text('postalCode', 'Postal code')}
          </FormGrid>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Locale & calendar" />
        <CardBody className="space-y-4">
          <FormGrid cols={3}>
            <FormField label="Timezone" error={errors.timezone}>
              {({ id }) => <Select id={id} options={TIMEZONES.map((t) => ({ value: t, label: t }))} {...form.register('timezone')} />}
            </FormField>
            {text('currency', 'Currency (ISO code)')}
            <FormField label="Date format">
              {({ id }) => <Select id={id} options={['dd/MM/yyyy', 'MM/dd/yyyy', 'yyyy-MM-dd', 'dd MMM yyyy'].map((f) => ({ value: f, label: f }))} {...form.register('dateFormat')} />}
            </FormField>
            <FormField label="Fiscal year starts">
              {({ id }) => <Select id={id} options={MONTHS.map((m, i) => ({ value: String(i + 1), label: m }))} {...form.register('fiscalYearStart')} />}
            </FormField>
            {text('employeeIdPrefix', 'Employee ID prefix')}
          </FormGrid>
          <fieldset>
            <legend className="mb-2 text-sm font-medium text-fg">Working days</legend>
            <div className="flex flex-wrap gap-2">
              {WEEKDAYS.map((d) => {
                const on = workingDays.includes(d);
                return (
                  <button
                    key={d}
                    type="button"
                    aria-pressed={on}
                    onClick={() => form.setValue('workingDays', on ? workingDays.filter((x) => x !== d) : [...workingDays, d], { shouldDirty: true })}
                    className={cn('h-9 w-12 rounded-lg border text-sm font-medium', on ? 'border-brand-600 bg-brand-600 text-white' : 'border-line-strong bg-surface text-fg-2 hover:bg-surface-2')}
                  >
                    {label(d)}
                  </button>
                );
              })}
            </div>
            <p className="mt-1.5 text-xs text-muted">Other days are treated as weekends for attendance, leave and payroll.</p>
          </fieldset>
        </CardBody>
      </Card>
      <div className="flex justify-end">
        <Button type="submit" loading={form.formState.isSubmitting}>
          Save changes
        </Button>
      </div>
    </form>
  );
};

/* -------------------------------- Users ------------------------------- */

interface RoleRow {
  _id: string;
  name: string;
  key?: string | null;
  description?: string;
  permissions: string[];
  isSystem: boolean;
  userCount?: number;
}

interface UserRow {
  _id: string;
  email: string;
  firstName: string;
  lastName: string;
  avatar?: string | null;
  status: string;
  emailVerified: boolean;
  lastLoginAt?: string | null;
  roles: { _id: string; name: string; key?: string }[];
  employeeId?: { _id: string; employeeId: string; firstName: string; lastName: string } | null;
}

const useRoles = () => useQuery({ queryKey: ['roles'], queryFn: () => get<RoleRow[]>('/roles') });

export const UsersSection = () => {
  const { params, query, set, clear, hasFilters } = useListParams({ sortBy: 'firstName', sortOrder: 'asc' });
  const users = useQuery({ queryKey: ['users', query], queryFn: () => getPaged<UserRow>('/users', query), placeholderData: keepPreviousData });
  const roles = useRoles();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { user: me } = usePermissions();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<UserRow | null>(null);

  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: object }) => patch(`/users/${id}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });
  const invite = useMutation({ mutationFn: (id: string) => post(`/users/${id}/invite`), onSuccess: () => toast.success('Invitation sent') });
  const [link, setLink] = useState<{ user: UserRow; url: string } | null>(null);
  const inviteLink = useMutation({
    mutationFn: (u: UserRow) => post<{ url: string }>(`/users/${u._id}/invite-link`).then((r) => ({ user: u, url: r.data.url })),
    onSuccess: (r) => setLink(r),
    onError: (e) => toast.error(toApiError(e).message),
  });

  const setStatus = async (u: UserRow, status: string) => {
    if (status !== 'ACTIVE') {
      const { confirmed } = await confirm({ title: `${status === 'SUSPENDED' ? 'Suspend' : 'Deactivate'} ${u.firstName}?`, message: 'They will be signed out immediately and cannot sign in until reactivated.', confirmLabel: 'Confirm' });
      if (!confirmed) return;
    }
    await update.mutateAsync({ id: u._id, body: { status } });
    toast.success('User updated');
  };

  const columns = useMemo<ColumnDef<UserRow, unknown>[]>(
    () => [
      {
        id: 'firstName',
        header: 'User',
        enableSorting: true,
        cell: ({ row }) => (
          <span className="flex items-center gap-3">
            <Avatar name={`${row.original.firstName} ${row.original.lastName}`} src={row.original.avatar} size="sm" />
            <span>
              <span className="block font-medium text-fg">
                {row.original.firstName} {row.original.lastName}
              </span>
              <span className="block text-xs text-muted">{row.original.email}</span>
            </span>
          </span>
        ),
      },
      { id: 'roles', header: 'Roles', cell: ({ row }) => <span className="flex flex-wrap gap-1">{row.original.roles.map((r) => <Badge key={r._id} tone={r.key === 'super_admin' ? 'brand' : 'gray'}>{r.name}</Badge>)}</span> },
      { id: 'employee', header: 'Employee', cell: ({ row }) => row.original.employeeId?.employeeId ?? '—' },
      {
        id: 'lastLoginAt',
        header: 'Last sign-in',
        enableSorting: true,
        cell: ({ row }) =>
          row.original.lastLoginAt ? (
            timeAgo(row.original.lastLoginAt)
          ) : row.original.emailVerified ? (
            <span className="text-muted">Never</span>
          ) : (
            // Not activated yet: hand them a link to set their own password (no email needed).
            <span className="flex flex-col items-start gap-1" onClick={(e) => e.stopPropagation()}>
              <span className="text-xs text-amber-700 dark:text-amber-300">Not activated</span>
              <Button size="xs" variant="outline" icon={<Link2 className="h-3.5 w-3.5" />} onClick={() => inviteLink.mutate(row.original)}>
                Get invite link
              </Button>
            </span>
          ),
      },
      { id: 'status', header: 'Status', enableSorting: true, cell: ({ row }) => <StatusBadge status={row.original.status} /> },
      {
        id: 'actions',
        header: '',
        cell: ({ row }) =>
          row.original._id === me?._id ? (
            <Badge>You</Badge>
          ) : (
            <div onClick={(e) => e.stopPropagation()}>
              <Dropdown
                label="User actions"
                trigger={<span className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-surface-3"><MoreHorizontal className="h-4 w-4" /></span>}
                items={[
                  { label: 'Edit roles', icon: <KeyRound className="h-4 w-4" />, onSelect: () => setEditing(row.original) },
                  { label: 'Resend invite', icon: <MailPlus className="h-4 w-4" />, onSelect: () => invite.mutate(row.original._id), hidden: row.original.emailVerified },
                  { label: 'Get invite link', icon: <Link2 className="h-4 w-4" />, onSelect: () => inviteLink.mutate(row.original), hidden: row.original.emailVerified || !!row.original.lastLoginAt },
                  { label: 'Activate', onSelect: () => void setStatus(row.original, 'ACTIVE'), hidden: row.original.status === 'ACTIVE' },
                  { label: 'Deactivate', danger: true, onSelect: () => void setStatus(row.original, 'INACTIVE'), hidden: row.original.status !== 'ACTIVE' },
                  { label: 'Suspend', danger: true, onSelect: () => void setStatus(row.original, 'SUSPENDED'), hidden: row.original.status === 'SUSPENDED' },
                ]}
              />
            </div>
          ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [me?._id],
  );

  return (
    <>
      <DataTable
        caption="Users"
        columns={columns}
        data={users.data?.data}
        loading={users.isLoading || users.isFetching}
        error={users.error}
        onRetry={() => users.refetch()}
        pagination={users.data?.pagination}
        onPageChange={(page) => set({ page })}
        sorting={{ sortBy: params.sortBy, sortOrder: params.sortOrder }}
        onSortingChange={(s) => set({ sortBy: s.sortBy, sortOrder: s.sortOrder })}
        toolbar={
          <>
            <FilterBar active={hasFilters(['search', 'status', 'roleId'])} onClear={() => clear()}>
              <SearchInput value={params.search} onSearch={(search) => set({ search })} placeholder="Search users…" />
              <Select aria-label="Status" className="w-36" value={String(params.status ?? '')} onChange={(e) => set({ status: e.target.value })} options={USER_STATUS.map((s) => ({ value: s, label: label(s) }))} placeholder="All statuses" />
              <Select aria-label="Role" className="w-44" value={String(params.roleId ?? '')} onChange={(e) => set({ roleId: e.target.value })} options={(roles.data ?? []).map((r) => ({ value: r._id, label: r.name }))} placeholder="All roles" />
            </FilterBar>
            <Button className="ml-auto" size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
              Invite user
            </Button>
          </>
        }
      />
      <InviteUserModal open={creating} onClose={() => setCreating(false)} roles={roles.data ?? []} />
      <EditRolesModal user={editing} onClose={() => setEditing(null)} roles={roles.data ?? []} />
      <Modal
        open={!!link}
        onClose={() => setLink(null)}
        title={link ? `Invite link for ${link.user.firstName}` : ''}
        description="Send this link to them directly (WhatsApp, SMS). They open it and set their own password. It works once and expires in 7 days."
        footer={
          <>
            <Button variant="outline" onClick={() => setLink(null)}>
              Close
            </Button>
            <Button
              icon={<Copy className="h-4 w-4" />}
              onClick={() => {
                if (!link) return;
                void navigator.clipboard.writeText(link.url).then(
                  () => toast.success('Link copied'),
                  () => toast.error('Could not copy — select the link and copy it'),
                );
              }}
            >
              Copy link
            </Button>
          </>
        }
      >
        {link && (
          <div className="space-y-3">
            <Input readOnly value={link.url} aria-label="Invite link" onFocus={(e) => e.currentTarget.select()} />
            <p className="text-xs text-muted">{`Sign-in email: ${link.user.email}. Getting a new link cancels any earlier one.`}</p>
          </div>
        )}
      </Modal>
    </>
  );
};

const InviteUserModal = ({ open, onClose, roles }: { open: boolean; onClose: () => void; roles: RoleRow[] }) => {
  const qc = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);
  type V = z.input<typeof userCreateSchema>;
  const form = useForm<V>({ resolver: zodResolver(userCreateSchema), defaultValues: { email: '', firstName: '', lastName: '', roleIds: [], sendInvite: true } });
  useEffect(() => {
    if (open) {
      form.reset({ email: '', firstName: '', lastName: '', roleIds: roles.filter((r) => r.key === 'employee').map((r) => r._id), sendInvite: true });
      setServerError(null);
    }
  }, [open, roles, form]);
  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await post('/users', values);
      toast.success('User created and invited');
      await qc.invalidateQueries({ queryKey: ['users'] });
      onClose();
    } catch (err) {
      setServerError(applyServerErrors(toApiError(err), form.setError, ['email', 'firstName', 'lastName', 'roleIds']));
    }
  });
  const roleIds = form.watch('roleIds') ?? [];
  return (
    <Modal open={open} onClose={onClose} title="Invite user" description="They'll receive an email to set their password." footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={onSubmit} loading={form.formState.isSubmitting}>Send invite</Button></>}>
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <FormError error={serverError} />
        <FormGrid>
          <FormField label="First name" error={form.formState.errors.firstName} required>{({ id, invalid }) => <Input id={id} aria-invalid={invalid} {...form.register('firstName')} />}</FormField>
          <FormField label="Last name" error={form.formState.errors.lastName} required>{({ id, invalid }) => <Input id={id} aria-invalid={invalid} {...form.register('lastName')} />}</FormField>
        </FormGrid>
        <FormField label="Email" error={form.formState.errors.email} required>{({ id, invalid }) => <Input id={id} type="email" aria-invalid={invalid} {...form.register('email')} />}</FormField>
        <FormField label="Link to employee" hint="Optional: connects this login to an existing employee record without an account.">
          {({ id }) => <EmployeePicker id={id} value={form.watch('employeeId') ?? null} onChange={(v) => form.setValue('employeeId', (v as string) ?? undefined)} />}
        </FormField>
        <FormField label="Roles" error={form.formState.errors.roleIds as { message?: string }} required>
          {({ id }) => <Combobox id={id} multiple value={roleIds} onChange={(v) => form.setValue('roleIds', (v as string[]) ?? [])} options={roles.map((r) => ({ value: r._id, label: r.name, description: r.description }))} />}
        </FormField>
      </form>
    </Modal>
  );
};

const EditRolesModal = ({ user, onClose, roles }: { user: UserRow | null; onClose: () => void; roles: RoleRow[] }) => {
  const [selected, setSelected] = useState<string[]>([]);
  const qc = useQueryClient();
  useEffect(() => setSelected(user?.roles.map((r) => r._id) ?? []), [user]);
  const save = useMutation({
    mutationFn: () => patch(`/users/${user!._id}`, { roleIds: selected }),
    onSuccess: async () => {
      toast.success('Roles updated');
      await qc.invalidateQueries({ queryKey: ['users'] });
      onClose();
    },
  });
  return (
    <Modal open={!!user} onClose={onClose} title={`Roles for ${user?.firstName ?? ''} ${user?.lastName ?? ''}`} footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={() => save.mutate()} loading={save.isPending} disabled={!selected.length}>Save</Button></>}>
      <div className="space-y-3">
        {roles.map((r) => (
          <Checkbox key={r._id} label={r.name} description={r.description} checked={selected.includes(r._id)} onChange={(e) => setSelected((s) => (e.target.checked ? [...s, r._id] : s.filter((x) => x !== r._id)))} />
        ))}
        <p className="text-xs text-muted">You can only grant permissions that you hold yourself.</p>
      </div>
    </Modal>
  );
};

/* ------------------------ Roles & Permissions ------------------------ */

interface PermissionGroup {
  group: string;
  label: string;
  permissions: { key: string; description: string }[];
}

export const RolesSection = () => {
  const roles = useRoles();
  const catalog = useQuery({ queryKey: ['roles', 'permissions'], queryFn: () => get<PermissionGroup[]>('/roles/permissions') });
  const [editing, setEditing] = useState<RoleRow | 'new' | null>(null);
  const confirm = useConfirm();
  const qc = useQueryClient();
  const remove = useMutation({ mutationFn: (id: string) => del(`/roles/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ['roles'] }) });

  if (roles.isLoading || catalog.isLoading) return <Skeleton className="h-96" />;
  if (roles.error) return <ErrorState message={roles.error.message} onRetry={() => roles.refetch()} />;

  return (
    <>
      <div className="mb-4 flex justify-end">
        <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')}>
          Create role
        </Button>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {roles.data?.map((r) => (
          <Card key={r._id} className="flex flex-col">
            <div className="flex items-start justify-between gap-3 p-4">
              <div>
                <p className="flex items-center gap-2 font-semibold text-fg">
                  {r.name}
                  {r.isSystem && <Badge tone="gray">System</Badge>}
                </p>
                <p className="mt-0.5 text-sm text-muted">{r.description || 'Custom role'}</p>
              </div>
              {r.key !== 'super_admin' && (
                <Dropdown
                  label={`Actions for ${r.name}`}
                  trigger={<span className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-surface-3"><MoreHorizontal className="h-4 w-4" /></span>}
                  items={[
                    { label: 'Edit permissions', icon: <Pencil className="h-4 w-4" />, onSelect: () => setEditing(r) },
                    {
                      label: 'Delete',
                      icon: <Trash2 className="h-4 w-4" />,
                      danger: true,
                      hidden: r.isSystem,
                      onSelect: async () => {
                        const { confirmed } = await confirm({ title: `Delete role ${r.name}?`, message: 'Roles still assigned to users cannot be deleted.', confirmLabel: 'Delete' });
                        if (confirmed) {
                          await remove.mutateAsync(r._id);
                          toast.success('Role deleted');
                        }
                      },
                    },
                  ]}
                />
              )}
              {r.key === 'super_admin' && <Lock className="h-4 w-4 text-muted" aria-label="Locked" />}
            </div>
            <div className="mt-auto flex items-center justify-between border-t border-line px-4 py-2.5 text-xs text-muted">
              <span>{r.permissions.length} permissions</span>
              <span>{r.userCount ?? 0} users</span>
            </div>
          </Card>
        ))}
      </div>
      <RoleEditor role={editing} onClose={() => setEditing(null)} catalog={catalog.data ?? []} />
    </>
  );
};

const RoleEditor = ({ role, onClose, catalog }: { role: RoleRow | 'new' | null; onClose: () => void; catalog: PermissionGroup[] }) => {
  const qc = useQueryClient();
  const { user } = usePermissions();
  const [serverError, setServerError] = useState<string | null>(null);
  type V = z.input<typeof roleSchema>;
  const form = useForm<V>({ resolver: zodResolver(roleSchema), defaultValues: { name: '', description: '', permissions: [] } });
  useEffect(() => {
    if (role) {
      setServerError(null);
      form.reset(role === 'new' ? { name: '', description: '', permissions: [] } : { name: role.name, description: role.description ?? '', permissions: role.permissions });
    }
  }, [role, form]);
  const perms = form.watch('permissions') ?? [];
  const toggle = (key: string, on: boolean) => form.setValue('permissions', on ? [...new Set([...perms, key])] : perms.filter((p) => p !== key), { shouldDirty: true });
  const onSubmit = form.handleSubmit(async (values) => {
    try {
      if (role === 'new') await post('/roles', values);
      else await put(`/roles/${(role as RoleRow)._id}`, values);
      toast.success('Role saved');
      await qc.invalidateQueries({ queryKey: ['roles'] });
      onClose();
    } catch (err) {
      setServerError(applyServerErrors(toApiError(err), form.setError, ['name', 'description', 'permissions']));
    }
  });
  const own = new Set(user?.permissions ?? []);
  return (
    <Drawer
      open={!!role}
      onClose={onClose}
      width="max-w-2xl"
      title={role === 'new' ? 'Create role' : `Edit ${role?.name ?? ''}`}
      description="Permissions you don't hold yourself can't be granted."
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={onSubmit} loading={form.formState.isSubmitting}>Save role</Button></>}
    >
      <form onSubmit={onSubmit} noValidate className="space-y-5">
        <FormError error={serverError} />
        <FormGrid>
          <FormField label="Name" error={form.formState.errors.name} required>
            {({ id, invalid }) => <Input id={id} aria-invalid={invalid} disabled={role !== 'new' && !!role && role.isSystem} {...form.register('name')} />}
          </FormField>
          <FormField label="Description">{({ id }) => <Input id={id} {...form.register('description')} />}</FormField>
        </FormGrid>
        <div className="space-y-4">
          {catalog.map((g) => {
            const all = g.permissions.every((p) => perms.includes(p.key));
            return (
              <fieldset key={g.group} className="rounded-lg border border-line p-4">
                <legend className="flex w-full items-center justify-between px-1 text-sm font-semibold text-fg">
                  {g.label}
                </legend>
                <div className="mb-2 flex justify-end">
                  <Button variant="link" size="xs" onClick={() => g.permissions.forEach((p) => own.has(p.key) && toggle(p.key, !all))} type="button">
                    {all ? 'Clear all' : 'Select all'}
                  </Button>
                </div>
                <div className="grid gap-2.5 sm:grid-cols-2">
                  {g.permissions.map((p) => (
                    <Checkbox key={p.key} label={p.description} description={p.key} checked={perms.includes(p.key)} disabled={!own.has(p.key)} onChange={(e) => toggle(p.key, e.target.checked)} />
                  ))}
                </div>
              </fieldset>
            );
          })}
        </div>
      </form>
    </Drawer>
  );
};

/* ------------------------------ Audit log ----------------------------- */

interface AuditRow {
  _id: string;
  action: string;
  module: string;
  recordLabel?: string;
  userName?: string;
  ipAddress?: string;
  timestamp: string;
  oldValues?: Record<string, unknown> | null;
  newValues?: Record<string, unknown> | null;
}

export const AuditLogSection = () => {
  const { params, query, set, clear, hasFilters } = useListParams();
  const logs = useQuery({ queryKey: ['audit-logs', query], queryFn: () => getPaged<AuditRow>('/audit-logs', query), placeholderData: keepPreviousData });
  const [open, setOpen] = useState<AuditRow | null>(null);
  const columns: ColumnDef<AuditRow, unknown>[] = [
    { id: 'timestamp', header: 'When', cell: ({ row }) => formatDateTime(row.original.timestamp) },
    { id: 'user', header: 'User', cell: ({ row }) => row.original.userName ?? 'System' },
    { id: 'action', header: 'Action', cell: ({ row }) => <Badge tone="brand">{label(row.original.action)}</Badge> },
    { id: 'module', header: 'Module', cell: ({ row }) => label(row.original.module) },
    { id: 'record', header: 'Record', cell: ({ row }) => <span className="block max-w-64 truncate">{row.original.recordLabel ?? '—'}</span> },
    { id: 'ip', header: 'IP', cell: ({ row }) => <span className="font-mono text-xs">{row.original.ipAddress ?? '—'}</span> },
  ];
  return (
    <>
      <DataTable
        caption="Audit log"
        columns={columns}
        data={logs.data?.data}
        loading={logs.isLoading || logs.isFetching}
        error={logs.error}
        onRetry={() => logs.refetch()}
        pagination={logs.data?.pagination}
        onPageChange={(page) => set({ page })}
        onRowClick={setOpen}
        emptyTitle="No audit events"
        toolbar={
          <FilterBar active={hasFilters(['search', 'action', 'from', 'to'])} onClear={() => clear()}>
            <SearchInput value={params.search} onSearch={(search) => set({ search })} placeholder="Search record or user…" />
            <Select aria-label="Action" className="w-52" value={String(params.action ?? '')} onChange={(e) => set({ action: e.target.value })} options={AUDIT_ACTIONS.map((a) => ({ value: a, label: label(a) }))} placeholder="All actions" />
            <DateRangePicker from={params.from as string | undefined} to={params.to as string | undefined} onChange={(r) => set({ from: r.from, to: r.to })} />
          </FilterBar>
        }
      />
      <Drawer open={!!open} onClose={() => setOpen(null)} title={open ? label(open.action) : ''} description={open ? `${open.userName ?? 'System'} · ${formatDateTime(open.timestamp)}` : undefined}>
        {open && (
          <div className="space-y-4 text-sm">
            <p><span className="text-muted">Record:</span> {open.recordLabel ?? '—'}</p>
            {(['oldValues', 'newValues'] as const).map((k) =>
              open[k] ? (
                <div key={k}>
                  <p className="mb-1 font-medium">{k === 'oldValues' ? 'Before' : 'After'}</p>
                  <pre className="scrollbar-thin overflow-x-auto rounded-lg bg-surface-3 p-3 text-xs">{JSON.stringify(open[k], null, 2)}</pre>
                </div>
              ) : null,
            )}
          </div>
        )}
      </Drawer>
    </>
  );
};
