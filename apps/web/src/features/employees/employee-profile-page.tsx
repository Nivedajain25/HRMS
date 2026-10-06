import { lazy, Suspense, useRef, useState, type ComponentType } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Archive, Briefcase, Building2, CalendarDays, Camera, Loader2, Mail, MapPin, Pencil, Phone, UserRound } from 'lucide-react';
import { StatusBadge } from '@/components/common/status-badge';
import { Button } from '@/components/ui/button';
import { Avatar, Card, CardBody, CardHeader, DescriptionList, ErrorState, PageSkeleton, Skeleton } from '@/components/ui/display';
import { Tabs, useConfirm } from '@/components/ui/overlay';
import { get, toApiError, upload } from '@/lib/api';
import { useRefreshMe } from '@/features/auth/use-auth';
import { label } from '@/lib/i18n';
import { formatDate, formatDateTime, fullName, shiftRange, timeAgo } from '@/lib/utils';
import { usePermissions } from '@/store/auth';
import { BalanceCards } from '@/features/leave/components/balance-cards';
import { useArchiveEmployee, useEmployee, useEmployeeHistory, type EmployeeDetail } from './api';
import { EmployeeFormDrawer } from './employee-form';

type TabProps = { employeeId: string };
const tab = (loader: () => Promise<{ default: ComponentType<TabProps> }>) => lazy(loader);

/** Tabs owned by other feature modules (loaded on demand). */
const MODULE_TABS: Record<string, ComponentType<TabProps>> = {
  attendance: tab(() => import('@/features/attendance/components/employee-attendance-tab')),
  leave: tab(() => import('@/features/leave/components/employee-leave-tab')),
  payroll: tab(() => import('@/features/payroll/components/employee-payroll-tab')),
  documents: tab(() => import('@/features/documents/components/employee-documents-tab')),
  assets: tab(() => import('@/features/assets/components/employee-assets-tab')),
  expenses: tab(() => import('@/features/expenses/components/employee-expenses-tab')),
  performance: tab(() => import('@/features/performance/components/employee-performance-tab')),
};

/** This year's leave balances on the profile overview (self, HR with leave:read, or the direct manager). */
const LeaveBalanceCard = ({ e }: { e: EmployeeDetail }) => {
  const { user, can } = usePermissions();
  const self = user?.employeeId === e._id;
  const isTheirManager = !!user?.employeeId && e.managerId?._id === user.employeeId;
  if (!self && !can('leave:read') && !isTheirManager) return null;
  return (
    <Card className="lg:col-span-3">
      <CardHeader
        title={`Leave balance · ${new Date().getFullYear()}`}
        actions={
          <Link to="?tab=leave" className="text-sm font-medium text-brand-600 hover:underline dark:text-brand-400">
            View leave →
          </Link>
        }
      />
      <CardBody>
        <BalanceCards employeeId={self ? undefined : e._id} year={new Date().getFullYear()} />
      </CardBody>
    </Card>
  );
};

const Overview = ({ e }: { e: EmployeeDetail }) => (
  <div className="grid gap-6 lg:grid-cols-3">
    <Card className="lg:col-span-2">
      <CardHeader title="Summary" />
      <CardBody>
        <DescriptionList
          items={[
            { label: 'Employee ID', value: <span className="font-mono">{e.employeeId}</span> },
            { label: 'Status', value: <StatusBadge status={e.employmentStatus} /> },
            { label: 'Department', value: e.departmentId?.name },
            { label: 'Designation', value: e.designationId?.name },
            { label: 'Reporting manager', value: e.managerId ? <Link className="text-brand-600 hover:underline dark:text-brand-400" to={`/employees/${e.managerId._id}`}>{fullName(e.managerId)}</Link> : null },
            { label: 'Direct reports', value: e.directReportCount },
            { label: 'Location', value: e.locationId?.name },
            { label: 'Shift', value: e.shiftId ? `${e.shiftId.name} (${shiftRange(e.shiftId.startTime, e.shiftId.endTime)})` : null },
            { label: 'Joined', value: formatDate(e.joiningDate) },
            { label: 'Employment type', value: label(e.employmentType) },
          ]}
        />
      </CardBody>
    </Card>
    <Card>
      <CardHeader title="Contact" />
      <CardBody className="space-y-3 text-sm">
        <p className="flex items-center gap-2"><Mail className="h-4 w-4 text-muted" /> <a className="hover:underline" href={`mailto:${e.workEmail}`}>{e.workEmail}</a></p>
        {e.phone && <p className="flex items-center gap-2"><Phone className="h-4 w-4 text-muted" /> <a className="hover:underline" href={`tel:${e.phone}`}>{e.phone}</a></p>}
        {e.city && <p className="flex items-center gap-2"><MapPin className="h-4 w-4 text-muted" /> {[e.city, e.country].filter(Boolean).join(', ')}</p>}
        {typeof e.userId === 'object' && e.userId && (
          <p className="text-xs text-muted">
            Account {label(e.userId.status).toLowerCase()} · last sign-in {e.userId.lastLoginAt ? timeAgo(e.userId.lastLoginAt) : 'never'}
          </p>
        )}
      </CardBody>
    </Card>
    <LeaveBalanceCard e={e} />
  </div>
);

const Personal = ({ e }: { e: EmployeeDetail }) => (
  <div className="grid gap-6 lg:grid-cols-2">
    <Card>
      <CardHeader title="Personal information" />
      <CardBody>
        <DescriptionList
          items={[
            { label: 'Full name', value: [e.firstName, e.middleName, e.lastName].filter(Boolean).join(' ') },
            { label: 'Gender', value: label(e.gender) },
            { label: 'Date of birth', value: e.dateOfBirth ? formatDate(e.dateOfBirth) : null },
            { label: 'Wedding anniversary', value: e.weddingAnniversary ? formatDate(e.weddingAnniversary) : null },
            { label: 'Blood group', value: e.bloodGroup },
            { label: 'Marital status', value: label(e.maritalStatus) },
            { label: 'Personal email', value: e.personalEmail },
            { label: 'Alternate phone', value: e.alternatePhone },
            { label: 'Address', value: [e.address, e.city, e.state, e.postalCode, e.country].filter(Boolean).join(', ') },
          ]}
        />
      </CardBody>
    </Card>
    <Card>
      <CardHeader title="Emergency contact" />
      <CardBody>
        <DescriptionList
          items={[
            { label: 'Name', value: e.emergencyContact?.contactName },
            { label: 'Relationship', value: e.emergencyContact?.relationship },
            { label: 'Phone', value: e.emergencyContact?.phone },
            { label: 'Address', value: e.emergencyContact?.address },
          ]}
        />
      </CardBody>
    </Card>
    {e.bank !== undefined && (
      <Card>
        <CardHeader title="Bank details" description={e.sensitiveVisible ? undefined : 'Masked — you do not have access to full details.'} />
        <CardBody>
          <DescriptionList
            items={[
              { label: 'Bank', value: e.bank?.bankName },
              { label: 'Account holder', value: e.bank?.accountHolderName },
              { label: 'Account number', value: <span className="font-mono">{e.bank?.accountNumber ?? e.bank?.accountNumberMasked}</span> },
              { label: 'IFSC / Routing', value: e.bank?.ifsc },
              { label: 'Branch', value: e.bank?.branch },
            ]}
          />
        </CardBody>
      </Card>
    )}
    {e.identity && Object.keys(e.identity).length > 0 && (
      <Card>
        <CardHeader title="Identity documents" />
        <CardBody>
          <DescriptionList items={Object.entries(e.identity).map(([k, v]) => ({ label: label(k), value: <span className="font-mono">{v}</span> }))} />
        </CardBody>
      </Card>
    )}
  </div>
);

const Employment = ({ e }: { e: EmployeeDetail }) => {
  const history = useEmployeeHistory(e._id);
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card>
        <CardHeader title="Employment" />
        <CardBody>
          <DescriptionList
            columns={1}
            items={[
              { label: 'Joining date', value: formatDate(e.joiningDate) },
              { label: 'Confirmation date', value: e.confirmationDate ? formatDate(e.confirmationDate) : null },
              { label: 'Probation', value: e.probationPeriodDays !== undefined ? `${e.probationPeriodDays} days` : null },
              { label: 'Notice period', value: e.noticePeriodDays !== undefined ? `${e.noticePeriodDays} days` : null },
              { label: 'Exit date', value: e.exitDate ? formatDate(e.exitDate) : null },
            ]}
          />
        </CardBody>
      </Card>
      <Card className="lg:col-span-2">
        <CardHeader title="Employment history" description="Department, designation, manager, salary, location, shift and status changes." />
        <CardBody>
          {history.isLoading ? (
            <Skeleton className="h-32" />
          ) : history.error ? (
            <ErrorState message={history.error.message} onRetry={() => history.refetch()} />
          ) : !history.data?.length ? (
            <p className="text-sm text-muted">No changes recorded yet.</p>
          ) : (
            <ol className="relative space-y-5 border-l border-line pl-5">
              {history.data.map((h) => (
                <li key={h._id} className="relative">
                  <span className="absolute top-1.5 -left-[25px] h-2.5 w-2.5 rounded-full border-2 border-surface bg-brand-600" aria-hidden />
                  <p className="text-sm text-fg">
                    <span className="font-medium">{label(h.field)}</span> changed{h.oldLabel ? <> from <span className="font-medium">{h.oldLabel}</span></> : null} to{' '}
                    <span className="font-medium">{h.newLabel ?? '—'}</span>
                  </p>
                  <p className="text-xs text-muted">
                    Effective {formatDate(h.effectiveDate)}
                    {h.changedBy ? ` · by ${fullName(h.changedBy)}` : ''}
                    {h.reason ? ` · ${h.reason}` : ''}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </CardBody>
      </Card>
    </div>
  );
};

interface AuditEntry {
  _id: string;
  action: string;
  userName?: string;
  timestamp: string;
  newValues?: Record<string, unknown> | null;
}

const Activity = ({ employeeId }: TabProps) => {
  const logs = useQuery({ queryKey: ['audit', 'employees', employeeId], queryFn: () => get<AuditEntry[]>(`/audit-logs/record/employees/${employeeId}`) });
  return (
    <Card>
      <CardHeader title="Activity" description="Audit trail for this employee record." />
      <CardBody>
        {logs.isLoading ? (
          <Skeleton className="h-32" />
        ) : logs.error ? (
          <ErrorState message={logs.error.message} onRetry={() => logs.refetch()} />
        ) : !logs.data?.length ? (
          <p className="text-sm text-muted">No activity recorded.</p>
        ) : (
          <ul className="divide-y divide-line">
            {logs.data.map((l) => (
              <li key={l._id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
                <span>
                  <span className="font-medium text-fg">{label(l.action)}</span>
                  {l.newValues && <span className="text-muted"> · {Object.keys(l.newValues).slice(0, 4).map(label).join(', ')}</span>}
                </span>
                <span className="text-xs text-muted">
                  {l.userName ?? 'System'} · {formatDateTime(l.timestamp)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
};

export const EmployeeProfileView = ({ employee: e, self }: { employee: EmployeeDetail; self?: boolean }) => {
  const [params, setParams] = useSearchParams();
  const active = params.get('tab') ?? 'overview';
  const { can, user } = usePermissions();
  const isSelf = self || user?.employeeId === e._id;
  const canPayroll = isSelf || can('salary:read') || can('payroll:read');

  const tabs = [
    { key: 'overview', label: 'Overview' },
    { key: 'personal', label: 'Personal', hidden: !isSelf && !can('employee:read') },
    { key: 'employment', label: 'Employment' },
    { key: 'attendance', label: 'Attendance' },
    { key: 'leave', label: 'Leave' },
    { key: 'payroll', label: 'Payroll', hidden: !canPayroll },
    { key: 'documents', label: 'Documents' },
    { key: 'assets', label: 'Assets' },
    { key: 'expenses', label: 'Expenses' },
    { key: 'performance', label: 'Performance' },
    { key: 'activity', label: 'Activity', hidden: !can('audit:read') && !can('employee:read') },
  ];
  const ModuleTab = MODULE_TABS[active];

  return (
    <div className="space-y-6">
      <Tabs tabs={tabs} active={active} onChange={(key) => setParams({ tab: key }, { replace: true })} />
      <div role="tabpanel" aria-labelledby={`tab-${active}`}>
        {active === 'overview' && <Overview e={e} />}
        {active === 'personal' && <Personal e={e} />}
        {active === 'employment' && <Employment e={e} />}
        {active === 'activity' && <Activity employeeId={e._id} />}
        {ModuleTab && (
          <Suspense fallback={<Skeleton className="h-64" />}>
            <ModuleTab employeeId={e._id} />
          </Suspense>
        )}
      </div>
    </div>
  );
};

const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_PHOTO_MB = 5;

/** Profile photo; when `editable`, the photo itself is the upload control (camera badge, "Change photo" on hover). */
const ProfilePhoto = ({ e, editable }: { e: EmployeeDetail; editable?: boolean }) => {
  const fileRef = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();
  const refreshMe = useRefreshMe();
  const { user } = usePermissions();
  const hasPhoto = !!e.profilePhoto;
  const photo = useMutation({
    mutationFn: (file: File) => upload(`/employees/${e._id}/photo`, file),
    onSuccess: async () => {
      toast.success('Photo updated');
      await qc.invalidateQueries({ queryKey: ['employees'] });
      if (user?.employeeId === e._id) await refreshMe();
    },
    onError: (err) => toast.error(toApiError(err).message),
  });

  const onPick = (ev: React.ChangeEvent<HTMLInputElement>) => {
    const file = ev.target.files?.[0];
    ev.target.value = ''; // allow picking the same file again
    if (!file) return;
    if (!PHOTO_TYPES.includes(file.type)) return void toast.error('Use a JPG, PNG or WebP image.');
    if (file.size > MAX_PHOTO_MB * 1024 * 1024) return void toast.error(`The photo must be smaller than ${MAX_PHOTO_MB} MB.`);
    photo.mutate(file);
  };

  if (!editable) return <Avatar name={fullName(e)} src={e.profilePhoto} size="xl" />;
  return (
    <>
      <input ref={fileRef} type="file" accept={PHOTO_TYPES.join(',')} className="sr-only" tabIndex={-1} aria-hidden onChange={onPick} />
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        disabled={photo.isPending}
        title={hasPhoto ? 'Change photo' : 'Upload photo'}
        aria-label={hasPhoto ? `Change profile photo of ${fullName(e)}` : `Upload profile photo for ${fullName(e)}`}
        className="group relative shrink-0 self-start rounded-full focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-surface focus-visible:outline-none sm:self-center"
      >
        <Avatar name={fullName(e)} src={e.profilePhoto} size="xl" />
        {!photo.isPending && (
          <span className="absolute inset-0 flex items-center justify-center rounded-full bg-slate-950/55 px-1 text-center text-[11px] leading-tight font-medium text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
            {hasPhoto ? 'Change photo' : 'Upload photo'}
          </span>
        )}
        {photo.isPending && (
          <span className="absolute inset-0 flex items-center justify-center rounded-full bg-slate-950/55 text-white">
            <Loader2 className="h-5 w-5 animate-spin" />
          </span>
        )}
        <span className="absolute -right-0.5 -bottom-0.5 flex h-7 w-7 items-center justify-center rounded-full border-2 border-surface bg-brand-600 text-white shadow-sm">
          <Camera className="h-3.5 w-3.5" />
        </span>
      </button>
    </>
  );
};

export const ProfileHeader = ({ e, actions, photoEditable }: { e: EmployeeDetail; actions?: React.ReactNode; photoEditable?: boolean }) => (
  <div className="card mb-6 flex flex-col gap-5 p-5 sm:flex-row sm:items-center">
    <ProfilePhoto e={e} editable={photoEditable} />
    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-semibold text-fg">{fullName(e)}</h1>
        <StatusBadge status={e.employmentStatus} />
      </div>
      <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted">
        <span className="flex items-center gap-1.5"><UserRound className="h-4 w-4" />{e.employeeId}</span>
        {e.designationId && <span className="flex items-center gap-1.5"><Briefcase className="h-4 w-4" />{e.designationId.name}</span>}
        {e.departmentId && <span className="flex items-center gap-1.5"><Building2 className="h-4 w-4" />{e.departmentId.name}</span>}
        <span className="flex items-center gap-1.5"><CalendarDays className="h-4 w-4" />Joined {formatDate(e.joiningDate)}</span>
      </div>
    </div>
    {actions && <div className="flex gap-2">{actions}</div>}
  </div>
);

export const EmployeeProfilePage = () => {
  const { id } = useParams();
  const employee = useEmployee(id);
  const [editing, setEditing] = useState(false);
  const { can, user } = usePermissions();
  const confirm = useConfirm();
  const archive = useArchiveEmployee();
  const navigate = useNavigate();

  if (employee.isLoading) return <PageSkeleton />;
  if (employee.error || !employee.data) return <ErrorState className="card" message={employee.error?.message} onRetry={() => employee.refetch()} />;
  const e = employee.data;

  const onArchive = async () => {
    const { confirmed } = await confirm({
      title: `Archive ${fullName(e)}?`,
      message: 'The employee will be removed from active lists and their user account deactivated. History is preserved.',
      confirmLabel: 'Archive',
    });
    if (!confirmed) return;
    await archive.mutateAsync(e._id);
    toast.success('Employee archived');
    navigate('/employees');
  };

  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-3 text-xs text-muted">
        <Link to="/employees" className="hover:text-fg">Employees</Link> / <span aria-current="page">{fullName(e)}</span>
      </nav>
      <ProfileHeader
        e={e}
        photoEditable={can('employee:update') || user?.employeeId === e._id}
        actions={
          <>
            {can('employee:update') && (
              <Button variant="outline" icon={<Pencil className="h-4 w-4" />} onClick={() => setEditing(true)}>
                Edit
              </Button>
            )}
            {can('employee:delete') && e.employmentStatus !== 'ARCHIVED' && (
              <Button variant="outline" icon={<Archive className="h-4 w-4" />} onClick={onArchive} loading={archive.isPending}>
                Archive
              </Button>
            )}
          </>
        }
      />
      <EmployeeProfileView employee={e} />
      <EmployeeFormDrawer open={editing} onClose={() => setEditing(false)} employee={e} />
    </>
  );
};
