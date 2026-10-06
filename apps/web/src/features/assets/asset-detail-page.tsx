import { useNavigate, useParams } from 'react-router-dom';
import { ChevronDown, Laptop, Undo2, UserPlus } from 'lucide-react';
import { StatusBadge } from '@/components/common/status-badge';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardBody, CardHeader, DescriptionList, EmptyState, ErrorState, PageHeader, PageSkeleton, PersonCell } from '@/components/ui/display';
import { Dropdown } from '@/components/ui/overlay';
import { label } from '@/lib/i18n';
import { apiDateKey, cn, formatDate, formatDateTime, formatMoney, fullName, toDateKey } from '@/lib/utils';
import { usePermissions } from '@/store/auth';
import { useAsset, type AssetDetail } from './api';
import { formatAssignmentPeriod, useAssetActions } from './components/asset-actions';

const AssignmentHistory = ({ asset }: { asset: AssetDetail }) => (
  <Card>
    <CardHeader title="Allocation history" description={`${asset.assignments.length} ${asset.assignments.length === 1 ? 'allocation' : 'allocations'}`} />
    {asset.assignments.length === 0 ? (
      <EmptyState title="Never allocated" description="Allocations and returns will be listed here." />
    ) : (
      <ul className="divide-y divide-line">
        {asset.assignments.map((a) => {
          const overdue = a.status === 'ACTIVE' && !!a.expectedReturnDate && apiDateKey(a.expectedReturnDate) < toDateKey(new Date());
          return (
            <li key={a._id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 space-y-2">
                <PersonCell name={fullName(a.employeeId)} subtitle={a.employeeId.employeeId} photo={a.employeeId.profilePhoto} to={`/employees/${a.employeeId._id}`} />
                <p className="text-xs text-muted">
                  {formatAssignmentPeriod(a)}
                  {a.assignedBy ? ` · issued by ${fullName(a.assignedBy)}` : ''}
                  {a.returnedTo ? ` · received by ${fullName(a.returnedTo)}` : ''}
                </p>
                {(a.notes || a.returnNotes) && (
                  <p className="text-xs text-fg-2">
                    {a.notes && <span className="block">Handover: {a.notes}</span>}
                    {a.returnNotes && <span className="block">Return: {a.returnNotes}</span>}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2 sm:flex-col sm:items-end">
                <StatusBadge status={a.status === 'ACTIVE' ? 'ASSIGNED' : 'RETURNED'} />
                {overdue && <Badge tone="red">Return overdue</Badge>}
                <span className="text-xs text-muted">
                  {label(a.conditionAtAssignment)}
                  {a.conditionAtReturn ? ` → ${label(a.conditionAtReturn)}` : ''}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    )}
  </Card>
);

const StatusTimeline = ({ asset }: { asset: AssetDetail }) => {
  const entries = [...asset.statusHistory].reverse();
  return (
    <Card>
      <CardHeader title="Status history" />
      <CardBody>
        {entries.length === 0 ? (
          <p className="text-sm text-muted">No status changes recorded.</p>
        ) : (
          <ol className="relative space-y-5 border-l border-line pl-5">
            {entries.map((h, i) => (
              <li key={`${h.at}-${i}`} className="relative">
                <span className={cn('absolute top-1.5 -left-[25px] h-2.5 w-2.5 rounded-full border-2 border-surface', i === 0 ? 'bg-brand-600' : 'bg-line-strong')} aria-hidden />
                <p className="flex flex-wrap items-center gap-1.5 text-sm text-fg">
                  {h.from ? (
                    <>
                      <StatusBadge status={h.from} /> <span className="text-muted">→</span>
                    </>
                  ) : null}
                  <StatusBadge status={h.to} />
                </p>
                {h.note && <p className="mt-1 text-sm text-fg-2">{h.note}</p>}
                <p className="mt-0.5 text-xs text-muted">{formatDateTime(h.at)}</p>
              </li>
            ))}
          </ol>
        )}
      </CardBody>
    </Card>
  );
};

export const AssetDetailPage = () => {
  const { id } = useParams();
  const asset = useAsset(id);
  const navigate = useNavigate();
  const { can, user } = usePermissions();
  const actions = useAssetActions({ onDeleted: () => navigate('/assets', { replace: true }) });

  if (asset.isLoading) return <PageSkeleton />;
  if (asset.error || !asset.data) return <ErrorState className="card" message={asset.error?.message} onRetry={() => asset.refetch()} />;
  const a = asset.data;
  const allowed = actions.allowed(a);
  const menu = actions.items(a).filter((i) => !i.hidden && i.label !== 'Assign' && i.label !== 'Record return');
  const currency = user?.organization.currency ?? 'USD';
  const active = a.assignments.find((x) => x.status === 'ACTIVE');
  const warrantyExpired = !!a.warrantyExpiry && apiDateKey(a.warrantyExpiry) < toDateKey(new Date());

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: can('asset:read') ? 'Assets' : 'My assets', to: '/assets' }, { label: a.assetTag }]}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {a.name}
            <StatusBadge status={a.status} />
          </span>
        }
        description={
          <>
            <span className="font-mono">{a.assetTag}</span> · {label(a.category)}
            {a.brand || a.model ? ` · ${[a.brand, a.model].filter(Boolean).join(' ')}` : ''}
          </>
        }
        actions={
          <>
            {allowed.assign && (
              <Button icon={<UserPlus className="h-4 w-4" />} onClick={() => actions.open({ kind: 'assign', asset: a })}>
                Assign
              </Button>
            )}
            {allowed.return && (
              <Button icon={<Undo2 className="h-4 w-4" />} onClick={() => actions.open({ kind: 'return', asset: a })}>
                Record return
              </Button>
            )}
            {menu.length > 0 && (
              <Dropdown
                label="More actions"
                items={menu}
                trigger={
                  <span className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line-strong bg-surface px-3 text-sm font-medium text-fg shadow-sm hover:bg-surface-2">
                    More <ChevronDown className="h-4 w-4" aria-hidden />
                  </span>
                }
              />
            )}
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Details" />
          <CardBody>
            <DescriptionList
              items={[
                { label: 'Asset tag', value: <span className="font-mono">{a.assetTag}</span> },
                { label: 'Category', value: label(a.category) },
                { label: 'Brand', value: a.brand },
                { label: 'Model', value: a.model },
                { label: 'Serial number', value: a.serialNumber ? <span className="font-mono">{a.serialNumber}</span> : null },
                { label: 'Condition', value: <Badge tone={a.condition === 'DAMAGED' ? 'red' : 'gray'}>{label(a.condition)}</Badge> },
                { label: 'Location', value: a.locationId ? [a.locationId.name, a.locationId.city].filter(Boolean).join(', ') : null },
                { label: 'Vendor', value: a.vendor },
                { label: 'Purchase date', value: a.purchaseDate ? formatDate(a.purchaseDate) : null },
                { label: 'Purchase cost', value: a.purchaseCost != null ? formatMoney(a.purchaseCost, currency) : null },
                {
                  label: 'Warranty expiry',
                  value: a.warrantyExpiry ? (
                    <span className="flex items-center gap-2">
                      {formatDate(a.warrantyExpiry)} {warrantyExpired && <Badge>Expired</Badge>}
                    </span>
                  ) : null,
                },
              ]}
            />
            {a.notes && (
              <div className="mt-5 border-t border-line pt-4">
                <h3 className="text-xs font-medium text-muted">Notes</h3>
                <p className="mt-1 text-sm whitespace-pre-line text-fg">{a.notes}</p>
              </div>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Current holder" />
          <CardBody>
            {a.currentEmployeeId ? (
              <div className="space-y-4">
                <PersonCell name={fullName(a.currentEmployeeId)} subtitle={a.currentEmployeeId.workEmail ?? a.currentEmployeeId.employeeId} photo={a.currentEmployeeId.profilePhoto} to={`/employees/${a.currentEmployeeId._id}`} />
                {active && (
                  <DescriptionList
                    columns={1}
                    items={[
                      { label: 'Assigned on', value: formatDate(active.assignedDate) },
                      {
                        label: 'Expected return',
                        value: active.expectedReturnDate ? (
                          <span className="flex items-center gap-2">
                            {formatDate(active.expectedReturnDate)}
                            {apiDateKey(active.expectedReturnDate) < toDateKey(new Date()) && <Badge tone="red">Overdue</Badge>}
                          </span>
                        ) : null,
                      },
                      { label: 'Condition at handover', value: label(active.conditionAtAssignment) },
                    ]}
                  />
                )}
              </div>
            ) : (
              <div className="flex flex-col items-center py-4 text-center">
                <span className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-surface-3 text-muted">
                  <Laptop className="h-5 w-5" aria-hidden />
                </span>
                <p className="text-sm text-muted">{a.status === 'AVAILABLE' ? 'In stock and ready to assign.' : `Not assigned (${label(a.status).toLowerCase()}).`}</p>
                {allowed.assign && (
                  <Button className="mt-4" size="sm" icon={<UserPlus className="h-4 w-4" />} onClick={() => actions.open({ kind: 'assign', asset: a })}>
                    Assign
                  </Button>
                )}
              </div>
            )}
          </CardBody>
        </Card>

        <div className={can('asset:read') ? 'lg:col-span-2' : 'lg:col-span-3'}>
          <AssignmentHistory asset={a} />
        </div>
        {can('asset:read') && <StatusTimeline asset={a} />}
      </div>
      {actions.element}
    </>
  );
};
