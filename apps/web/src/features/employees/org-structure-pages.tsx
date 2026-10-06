import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import type { FieldValues, UseFormReturn } from 'react-hook-form';
import { toast } from 'sonner';
import {
  Briefcase,
  Building2,
  Calculator,
  ChevronDown,
  ChevronRight,
  Footprints,
  HandHelping,
  LocateFixed,
  MapPin,
  Network,
  ShieldCheck,
  Store,
  TrendingUp,
  Truck,
  Users,
  Warehouse,
  Wrench,
} from 'lucide-react';
import { ENTITY_STATUS, LOCATION_TYPES, departmentSchema, designationSchema, locationSchema } from '@stencil/shared';
import { MasterDataPage } from '@/components/common/master-data-page';
import { StatusBadge } from '@/components/common/status-badge';
import { Avatar, Card, EmptyState, ErrorState, IconTitle, PageHeader, PersonCell, Skeleton } from '@/components/ui/display';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/input';
import { get } from '@/lib/api';
import { getBrowserLocation, locationHelp } from '@/features/attendance/lib';
import { label } from '@/lib/i18n';
import { cn, fullName } from '@/lib/utils';
import { toOptions, useAllOf } from './api';

const statusOptions = ENTITY_STATUS.map((s) => ({ value: s, label: label(s) }));
const count = (n?: number) => (
  <span className="inline-flex items-center gap-1.5 text-fg-2">
    <Users className="h-3.5 w-3.5 text-muted" />
    {n ?? 0}
  </span>
);

interface PersonRef {
  _id: string;
  employeeId: string;
  firstName: string;
  lastName: string;
  profilePhoto?: string | null;
}

interface DepartmentRow {
  _id: string;
  name: string;
  code: string;
  description?: string;
  status: string;
  employeeCount?: number;
  headId?: PersonRef | null;
  parentId?: { _id: string; name: string } | null;
}

/** An icon and tile colour per department, picked from its name (anything unknown gets a building). */
const DEPARTMENT_ICONS: { match: RegExp; icon: typeof Building2; tone: string }[] = [
  { match: /account|finance/i, icon: Calculator, tone: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300' },
  { match: /admin/i, icon: ShieldCheck, tone: 'bg-violet-100 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300' },
  { match: /dispatch|logistic|delivery/i, icon: Truck, tone: 'bg-orange-100 text-orange-600 dark:bg-orange-500/15 dark:text-orange-300' },
  { match: /engineer|tech|it\b/i, icon: Wrench, tone: 'bg-sky-100 text-sky-600 dark:bg-sky-500/15 dark:text-sky-300' },
  { match: /help|support|staff/i, icon: HandHelping, tone: 'bg-teal-100 text-teal-600 dark:bg-teal-500/15 dark:text-teal-300' },
  { match: /runner|courier/i, icon: Footprints, tone: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300' },
  { match: /sales|marketing/i, icon: TrendingUp, tone: 'bg-rose-100 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300' },
  { match: /showroom|store|retail/i, icon: Store, tone: 'bg-fuchsia-100 text-fuchsia-600 dark:bg-fuchsia-500/15 dark:text-fuchsia-300' },
  { match: /warehouse|inventory|stock/i, icon: Warehouse, tone: 'bg-indigo-100 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300' },
];
const departmentIcon = (name: string) =>
  DEPARTMENT_ICONS.find((d) => d.match.test(name)) ?? { icon: Building2, tone: 'bg-slate-100 text-slate-600 dark:bg-slate-500/15 dark:text-slate-300' };

const DepartmentName = ({ name }: { name: string }) => {
  const { icon: Icon, tone } = departmentIcon(name);
  return (
    <span className="flex items-center gap-2.5">
      <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', tone)} aria-hidden>
        <Icon className="h-4 w-4" />
      </span>
      <span className="font-medium text-fg">{name}</span>
    </span>
  );
};

export const DepartmentsPage = () => {
  const departments = useAllOf('departments');
  const columns: ColumnDef<DepartmentRow, unknown>[] = [
    { id: 'name', header: 'Department', enableSorting: true, cell: ({ row }) => <DepartmentName name={row.original.name} /> },
    { id: 'code', header: 'Code', enableSorting: true, cell: ({ row }) => <span className="font-mono text-xs">{row.original.code}</span> },
    { id: 'head', header: 'Head', cell: ({ row }) => (row.original.headId ? <PersonCell name={fullName(row.original.headId)} photo={row.original.headId.profilePhoto} /> : '—') },
    { id: 'parent', header: 'Parent', cell: ({ row }) => row.original.parentId?.name ?? '—' },
    { id: 'employees', header: 'Employees', cell: ({ row }) => count(row.original.employeeCount) },
    { id: 'status', header: 'Status', cell: ({ row }) => <StatusBadge status={row.original.status} /> },
  ];
  return (
    <MasterDataPage<DepartmentRow>
      resource="departments"
      title="Departments"
      icon={<Building2 />}
      singular="Department"
      description="Organize teams and reporting lines."
      schema={departmentSchema}
      managePermission="department:manage"
      columns={columns}
      defaults={{ status: 'ACTIVE' }}
      deleteMessage="Departments with active employees or sub-departments cannot be archived."
      toForm={(d) => ({ name: d.name, code: d.code, description: d.description ?? '', headId: d.headId?._id ?? '', parentId: d.parentId?._id ?? '', status: d.status })}
      fields={[
        { name: 'name', label: 'Name', required: true },
        { name: 'code', label: 'Code', required: true, hint: 'Short unique code, e.g. ENG' },
        { name: 'headId', label: 'Department head', type: 'employee', selectedLabel: (d) => (d.headId ? { [(d.headId as PersonRef)._id]: fullName(d.headId as PersonRef) } : undefined) },
        { name: 'parentId', label: 'Parent department', type: 'select', options: toOptions(departments.data), placeholder: 'None (top level)' },
        { name: 'status', label: 'Status', type: 'select', options: statusOptions },
        { name: 'description', label: 'Description', type: 'textarea' },
      ]}
    />
  );
};

interface DesignationRow {
  _id: string;
  name: string;
  code: string;
  level: number;
  status: string;
  description?: string;
  employeeCount?: number;
  departmentId?: { _id: string; name: string } | null;
}

export const DesignationsPage = () => {
  const departments = useAllOf('departments');
  const columns: ColumnDef<DesignationRow, unknown>[] = [
    { id: 'name', header: 'Designation', enableSorting: true, cell: ({ row }) => <span className="font-medium text-fg">{row.original.name}</span> },
    { id: 'code', header: 'Code', enableSorting: true, cell: ({ row }) => <span className="font-mono text-xs">{row.original.code}</span> },
    { id: 'level', header: 'Level', enableSorting: true, cell: ({ row }) => `L${row.original.level}` },
    { id: 'department', header: 'Department', cell: ({ row }) => row.original.departmentId?.name ?? 'Any' },
    { id: 'employees', header: 'Employees', cell: ({ row }) => count(row.original.employeeCount) },
    { id: 'status', header: 'Status', cell: ({ row }) => <StatusBadge status={row.original.status} /> },
  ];
  return (
    <MasterDataPage<DesignationRow>
      resource="designations"
      title="Designations"
      icon={<Briefcase />}
      singular="Designation"
      description="Job titles and levels."
      schema={designationSchema}
      managePermission="designation:manage"
      columns={columns}
      defaults={{ level: 1, status: 'ACTIVE' }}
      toForm={(d) => ({ name: d.name, code: d.code, level: d.level, departmentId: d.departmentId?._id ?? '', description: d.description ?? '', status: d.status })}
      filters={(set, params) => (
        <Select aria-label="Department" className="w-48" value={String(params.departmentId ?? '')} onChange={(e) => set({ departmentId: e.target.value })} options={toOptions(departments.data)} placeholder="All departments" />
      )}
      fields={[
        { name: 'name', label: 'Name', required: true },
        { name: 'code', label: 'Code', required: true },
        { name: 'level', label: 'Level', type: 'number', hint: '1 = entry level' },
        { name: 'departmentId', label: 'Department', type: 'select', options: toOptions(departments.data), placeholder: 'Any department' },
        { name: 'status', label: 'Status', type: 'select', options: statusOptions },
        { name: 'description', label: 'Description', type: 'textarea' },
      ]}
    />
  );
};

interface LocationRow {
  _id: string;
  name: string;
  type: string;
  city?: string;
  state?: string;
  country?: string;
  address?: string;
  postalCode?: string;
  timezone?: string;
  latitude?: number;
  longitude?: number;
  geofenceRadiusMeters?: number;
  status: string;
  employeeCount?: number;
}

/** Default office area when HR sets the position from their device and no radius is set yet. */
const DEFAULT_OFFICE_RADIUS_M = 150;

/** Fills the office coordinates from this device's GPS (HR standing in the office). */
const UseMyLocation = ({ form }: { form: UseFormReturn<FieldValues> }) => {
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const onClick = async () => {
    setBusy(true);
    setInfo(null);
    const loc = await getBrowserLocation(15_000);
    setBusy(false);
    if ('error' in loc) {
      toast.error('Could not get your location.', { description: locationHelp(loc.error) });
      return;
    }
    const opts = { shouldDirty: true, shouldValidate: true };
    form.setValue('latitude', loc.latitude, opts);
    form.setValue('longitude', loc.longitude, opts);
    if (!Number(form.getValues('geofenceRadiusMeters'))) form.setValue('geofenceRadiusMeters', DEFAULT_OFFICE_RADIUS_M, opts);
    setInfo(`Filled from your current position${loc.accuracy ? ` (accurate to about ${loc.accuracy} m)` : ''}. Click Save to apply.`);
  };
  return (
    <div className="rounded-xl border border-dashed border-line p-4">
      <p className="text-sm font-medium text-fg">Office position for attendance</p>
      <p className="mt-1 text-xs text-muted">
        Standing in the office? Fill the latitude and longitude from this device’s GPS. Clock-ins within the office area count as <span className="font-medium">At office</span>; others are
        allowed but flagged <span className="font-medium">Outside office</span> for HR and in reports.
      </p>
      <Button type="button" variant="outline" size="sm" className="mt-3" icon={<LocateFixed className="h-4 w-4" />} loading={busy} onClick={onClick}>
        Use my current location
      </Button>
      {info && (
        <p className="mt-2 text-xs text-emerald-700 dark:text-emerald-300" role="status">
          {info}
        </p>
      )}
    </div>
  );
};

export const LocationsPage = () => {
  const columns: ColumnDef<LocationRow, unknown>[] = [
    { id: 'name', header: 'Location', enableSorting: true, cell: ({ row }) => <span className="font-medium text-fg">{row.original.name}</span> },
    { id: 'type', header: 'Type', enableSorting: true, cell: ({ row }) => label(row.original.type) },
    { id: 'city', header: 'City', enableSorting: true, cell: ({ row }) => [row.original.city, row.original.country].filter(Boolean).join(', ') || '—' },
    {
      id: 'officeArea',
      header: 'Office area',
      cell: ({ row }) => {
        const l = row.original;
        if (typeof l.latitude !== 'number' || typeof l.longitude !== 'number') return <span className="text-muted">Not set</span>;
        return l.geofenceRadiusMeters ? <span className="tabular-nums">{l.geofenceRadiusMeters} m radius</span> : <span className="text-muted">Position only</span>;
      },
    },
    { id: 'timezone', header: 'Timezone', cell: ({ row }) => row.original.timezone ?? '—' },
    { id: 'employees', header: 'Employees', cell: ({ row }) => count(row.original.employeeCount) },
    { id: 'status', header: 'Status', cell: ({ row }) => <StatusBadge status={row.original.status} /> },
  ];
  return (
    <MasterDataPage<LocationRow>
      resource="locations"
      title="Locations"
      icon={<MapPin />}
      singular="Location"
      description="Offices, branches and remote work arrangements."
      schema={locationSchema}
      managePermission="location:manage"
      columns={columns}
      defaults={{ type: 'OFFICE', status: 'ACTIVE' }}
      toForm={(l) => ({ ...l, latitude: l.latitude ?? '', longitude: l.longitude ?? '', geofenceRadiusMeters: l.geofenceRadiusMeters ?? '' })}
      filters={(set, params) => (
        <Select aria-label="Type" className="w-36" value={String(params.type ?? '')} onChange={(e) => set({ type: e.target.value })} options={LOCATION_TYPES.map((t) => ({ value: t, label: label(t) }))} placeholder="All types" />
      )}
      fields={[
        { name: 'name', label: 'Name', required: true },
        { name: 'type', label: 'Type', type: 'select', options: LOCATION_TYPES.map((t) => ({ value: t, label: label(t) })) },
        { name: 'address', label: 'Address', type: 'textarea' },
        { name: 'city', label: 'City' },
        { name: 'state', label: 'State / Region' },
        { name: 'country', label: 'Country' },
        { name: 'postalCode', label: 'Postal code' },
        { name: 'timezone', label: 'Timezone', placeholder: 'e.g. Asia/Kolkata' },
        { name: 'status', label: 'Status', type: 'select', options: statusOptions },
        { name: 'latitude', label: 'Latitude', type: 'number' },
        { name: 'longitude', label: 'Longitude', type: 'number' },
        {
          name: 'geofenceRadiusMeters',
          label: 'Office area radius (m)',
          type: 'number',
          hint: `Clock-ins within this distance count as “At office”; further away is flagged “Outside office” (never blocked). 0 = record distance only. ${DEFAULT_OFFICE_RADIUS_M} m suits most offices.`,
        },
      ]}
      formExtras={(form) => <UseMyLocation form={form} />}
    />
  );
};

/* ------------------------------ Org chart ----------------------------- */

interface OrgNode {
  _id: string;
  employeeId: string;
  firstName: string;
  lastName: string;
  profilePhoto?: string | null;
  designationId?: { name: string } | null;
  departmentId?: { name: string } | null;
  children: OrgNode[];
}

const OrgBranch = ({ node, depth }: { node: OrgNode; depth: number }) => {
  const [open, setOpen] = useState(depth < 2);
  return (
    <li>
      <div className="flex items-center gap-2 py-1.5" style={{ paddingLeft: depth * 24 }}>
        {node.children.length ? (
          <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label={open ? 'Collapse' : 'Expand'} className="rounded p-0.5 text-muted hover:bg-surface-3">
            {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        ) : (
          <span className="w-5" />
        )}
        <Link to={`/employees/${node._id}`} className="flex min-w-0 items-center gap-3 rounded-lg border border-line bg-surface px-3 py-2 hover:border-brand-300 hover:shadow-card">
          <Avatar name={fullName(node)} src={node.profilePhoto} size="sm" />
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium text-fg">{fullName(node)}</span>
            <span className="block truncate text-xs text-muted">{[node.designationId?.name, node.departmentId?.name].filter(Boolean).join(' · ') || node.employeeId}</span>
          </span>
          {node.children.length > 0 && <span className="ml-2 rounded-full bg-surface-3 px-2 text-xs text-fg-2">{node.children.length}</span>}
        </Link>
      </div>
      {open && node.children.length > 0 && (
        <ul className={cn('border-l border-dashed border-line')} style={{ marginLeft: depth * 24 + 10 }}>
          {node.children.map((c) => (
            <OrgBranch key={c._id} node={c} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
};

export const OrgChartPage = () => {
  const chart = useQuery({ queryKey: ['employees', 'org-chart'], queryFn: () => get<OrgNode[]>('/employees/org-chart') });
  return (
    <>
      <PageHeader title={<IconTitle icon={<Network />}>Organization chart</IconTitle>} description="Reporting lines across the organization." breadcrumb={[{ label: 'People' }, { label: 'Org Chart' }]} />
      <Card className="scrollbar-thin overflow-x-auto p-4">
        {chart.isLoading ? (
          <Skeleton className="h-64" />
        ) : chart.error ? (
          <ErrorState message={chart.error.message} onRetry={() => chart.refetch()} />
        ) : !chart.data?.length ? (
          <EmptyState title="No employees yet" />
        ) : (
          <ul className="min-w-max">
            {chart.data.map((n) => (
              <OrgBranch key={n._id} node={n} depth={0} />
            ))}
          </ul>
        )}
      </Card>
    </>
  );
};
