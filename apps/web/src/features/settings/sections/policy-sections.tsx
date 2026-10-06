import { useEffect, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowDown, ArrowUp, CheckCircle2, Mail, Plug, Plus, Trash2, XCircle } from 'lucide-react';
import { APPROVER_TYPES, type ApproverType } from '@stencil/shared';
import { FormField, FormGrid } from '@/components/forms/form';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardBody, CardHeader, ErrorState, Skeleton } from '@/components/ui/display';
import { Input, Select, Switch } from '@/components/ui/input';
import { get, patch, post, toApiError } from '@/lib/api';
import { label } from '@/lib/i18n';

interface OrgSettings {
  attendance: {
    allowRemoteClockIn: boolean;
    halfDayThresholdHours: number;
    overtimeAfterHours: number;
    autoMarkAbsent: boolean;
    defaultShiftStart: string;
    defaultShiftEnd: string;
    requireSelfie?: boolean;
    requireLocation?: boolean;
  };
  approvals: { leave: ApproverType[]; regularization: ApproverType[]; expense: ApproverType[] };
  leave: { allowNegativeBalance: boolean; allowBackdatedDays: number };
  payroll: { payDay: number; workingDaysBasis: 'CALENDAR' | 'WORKING'; overtimeMultiplier: number; countryRules: string };
  identityFields: { key: string; label: string; enabled: boolean; required: boolean }[];
  security: { sessionTimeoutMinutes: number; maxLoginAttempts: number };
  notifications: { documentExpiryDays: number; birthdayReminders: boolean; anniversaryReminders: boolean };
}

const useSettings = () => useQuery({ queryKey: ['organization', 'settings'], queryFn: () => get<OrgSettings>('/organization/settings') });

/** Loads one settings section into local state and saves it with PATCH. */
const useSection = <K extends keyof OrgSettings>(key: K) => {
  const settings = useSettings();
  const qc = useQueryClient();
  const [value, setValue] = useState<OrgSettings[K] | null>(null);
  useEffect(() => {
    if (settings.data) setValue(structuredClone(settings.data[key]));
  }, [settings.data, key]);
  const save = useMutation({
    mutationFn: (v: OrgSettings[K]) => patch('/organization/settings', { [key]: v }),
    onSuccess: async () => {
      toast.success('Settings saved');
      await qc.invalidateQueries({ queryKey: ['organization', 'settings'] });
      // The clock widget reads the capture requirements from /attendance/today.
      if (key === 'attendance') await qc.invalidateQueries({ queryKey: ['attendance', 'today'] });
    },
  });
  return { settings, value, setValue, save };
};

const SectionShell = ({ loading, error, onRetry, children, onSave, saving }: { loading: boolean; error: Error | null; onRetry: () => void; children: ReactNode; onSave: () => void; saving: boolean }) => {
  if (loading) return <Skeleton className="h-64" />;
  if (error) return <ErrorState message={error.message} onRetry={onRetry} />;
  return (
    <Card>
      <CardBody className="space-y-5">{children}</CardBody>
      <div className="flex justify-end border-t border-line bg-surface-2 px-5 py-3">
        <Button onClick={onSave} loading={saving}>
          Save changes
        </Button>
      </div>
    </Card>
  );
};

const ToggleRow = ({ title, description, checked, onChange }: { title: string; description?: string; checked: boolean; onChange: (v: boolean) => void }) => (
  <div className="flex items-start justify-between gap-6">
    <div>
      <p className="text-sm font-medium text-fg">{title}</p>
      {description && <p className="text-sm text-muted">{description}</p>}
    </div>
    <Switch checked={checked} onChange={onChange} label={title} />
  </div>
);

export const AttendanceSettingsSection = () => {
  const { settings, value, setValue, save } = useSection('attendance');
  const v = value;
  return (
    <SectionShell loading={!v} error={settings.error} onRetry={() => settings.refetch()} onSave={() => v && save.mutate(v)} saving={save.isPending}>
      {v && (
        <>
          <ToggleRow title="Allow remote clock-in" description="Employees may clock in with the Remote work mode." checked={v.allowRemoteClockIn} onChange={(allowRemoteClockIn) => setValue({ ...v, allowRemoteClockIn })} />
          <ToggleRow title="Auto-mark absence" description="Each night, working days without a clock-in or leave are marked absent; holidays and week-offs are recorded." checked={v.autoMarkAbsent} onChange={(autoMarkAbsent) => setValue({ ...v, autoMarkAbsent })} />
          <ToggleRow
            title="Require selfie at clock in"
            description="Employees take a front-camera photo when they clock in. Photos are visible only to the employee, their managers and HR."
            checked={v.requireSelfie ?? false}
            onChange={(requireSelfie) => setValue({ ...v, requireSelfie })}
          />
          <ToggleRow
            title="Require location at clock in"
            description="Clocking in needs the device's GPS location (clock-out records it when available). Locations are visible only to the employee, their managers and HR."
            checked={v.requireLocation ?? false}
            onChange={(requireLocation) => setValue({ ...v, requireLocation })}
          />
          <FormGrid>
            <FormField label="Overtime after (hours/day)" hint="Overtime counts beyond the larger of this and the shift's hours.">
              {({ id }) => <Input id={id} type="number" min={0} max={24} step={0.5} value={v.overtimeAfterHours} onChange={(e) => setValue({ ...v, overtimeAfterHours: Number(e.target.value) })} />}
            </FormField>
            <FormField label="Half-day threshold (hours)">
              {({ id }) => <Input id={id} type="number" min={0} max={24} step={0.5} value={v.halfDayThresholdHours} onChange={(e) => setValue({ ...v, halfDayThresholdHours: Number(e.target.value) })} />}
            </FormField>
            <FormField label="Fallback shift start">{({ id }) => <Input id={id} type="time" value={v.defaultShiftStart} onChange={(e) => setValue({ ...v, defaultShiftStart: e.target.value })} />}</FormField>
            <FormField label="Fallback shift end">{({ id }) => <Input id={id} type="time" value={v.defaultShiftEnd} onChange={(e) => setValue({ ...v, defaultShiftEnd: e.target.value })} />}</FormField>
          </FormGrid>
        </>
      )}
    </SectionShell>
  );
};

export const LeaveSettingsSection = () => {
  const { settings, value: v, setValue, save } = useSection('leave');
  return (
    <SectionShell loading={!v} error={settings.error} onRetry={() => settings.refetch()} onSave={() => v && save.mutate(v)} saving={save.isPending}>
      {v && (
        <>
          <ToggleRow title="Allow negative balance" description="Employees may apply for paid leave beyond their remaining balance." checked={v.allowNegativeBalance} onChange={(allowNegativeBalance) => setValue({ ...v, allowNegativeBalance })} />
          <FormField label="Backdated requests allowed (days)" hint="How far in the past employees may apply for leave.">
            {({ id }) => <Input id={id} type="number" min={0} max={365} className="max-w-40" value={v.allowBackdatedDays} onChange={(e) => setValue({ ...v, allowBackdatedDays: Number(e.target.value) })} />}
          </FormField>
          <p className="text-sm text-muted">Leave types, allowances and carry-forward rules are managed under Leave → Leave Types.</p>
        </>
      )}
    </SectionShell>
  );
};

export const PayrollSettingsSection = () => {
  const { settings, value: v, setValue, save } = useSection('payroll');
  const packs = useQuery({ queryKey: ['organization', 'payroll-packs'], queryFn: () => get<{ code: string; name: string; disclaimer: string }[]>('/organization/payroll-rule-packs') });
  const pack = packs.data?.find((p) => p.code === v?.countryRules);
  return (
    <SectionShell loading={!v} error={settings.error} onRetry={() => settings.refetch()} onSave={() => v && save.mutate(v)} saving={save.isPending}>
      {v && (
        <>
          <FormGrid>
            <FormField label="Pay day (day of month)">{({ id }) => <Input id={id} type="number" min={1} max={31} value={v.payDay} onChange={(e) => setValue({ ...v, payDay: Number(e.target.value) })} />}</FormField>
            <FormField label="Payable days basis" hint="Calendar: all days in the month. Working: only working days.">
              {({ id }) => (
                <Select id={id} value={v.workingDaysBasis} onChange={(e) => setValue({ ...v, workingDaysBasis: e.target.value as 'CALENDAR' | 'WORKING' })} options={[{ value: 'CALENDAR', label: 'Calendar days' }, { value: 'WORKING', label: 'Working days' }]} />
              )}
            </FormField>
            <FormField label="Overtime multiplier">{({ id }) => <Input id={id} type="number" min={1} max={5} step={0.25} value={v.overtimeMultiplier} onChange={(e) => setValue({ ...v, overtimeMultiplier: Number(e.target.value) })} />}</FormField>
            <FormField label="Rule pack">
              {({ id }) => <Select id={id} value={v.countryRules} onChange={(e) => setValue({ ...v, countryRules: e.target.value })} options={(packs.data ?? []).map((p) => ({ value: p.code, label: p.name }))} />}
            </FormField>
          </FormGrid>
          {pack && <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">{pack.disclaimer} Stencil does not guarantee statutory compliance.</p>}
        </>
      )}
    </SectionShell>
  );
};

const APPROVAL_FLOWS: { key: 'leave' | 'regularization' | 'expense'; title: string }[] = [
  { key: 'leave', title: 'Leave requests' },
  { key: 'regularization', title: 'Attendance regularization' },
  { key: 'expense', title: 'Expenses' },
];

export const ApprovalSettingsSection = () => {
  const { settings, value: v, setValue, save } = useSection('approvals');
  const update = (key: keyof OrgSettings['approvals'], chain: ApproverType[]) => v && setValue({ ...v, [key]: chain });
  return (
    <SectionShell loading={!v} error={settings.error} onRetry={() => settings.refetch()} onSave={() => v && save.mutate(v)} saving={save.isPending}>
      {v && (
        <>
          <p className="text-sm text-muted">Requests move through these steps in order. The manager step is skipped automatically for employees without a manager. Nobody can approve their own request.</p>
          {APPROVAL_FLOWS.map(({ key, title }) => {
            const chain = v[key];
            const unused = APPROVER_TYPES.filter((t) => !chain.includes(t));
            return (
              <div key={key} className="rounded-lg border border-line p-4">
                <p className="mb-3 text-sm font-semibold text-fg">{title}</p>
                <ol className="flex flex-wrap items-center gap-2">
                  {chain.map((step, i) => (
                    <li key={step} className="flex items-center gap-1 rounded-lg border border-line bg-surface-2 py-1 pr-1 pl-3 text-sm">
                      <span className="mr-1 text-xs text-muted">{i + 1}.</span>
                      {label(step)}
                      <Button variant="ghost" size="icon-sm" aria-label={`Move ${label(step)} earlier`} disabled={i === 0} onClick={() => update(key, chain.map((s, j) => (j === i - 1 ? step : j === i ? chain[i - 1]! : s)))}>
                        <ArrowUp className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon-sm" aria-label={`Move ${label(step)} later`} disabled={i === chain.length - 1} onClick={() => update(key, chain.map((s, j) => (j === i + 1 ? step : j === i ? chain[i + 1]! : s)))}>
                        <ArrowDown className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon-sm" aria-label={`Remove ${label(step)}`} disabled={chain.length === 1} onClick={() => update(key, chain.filter((s) => s !== step))}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </li>
                  ))}
                  {unused.length > 0 && (
                    <li>
                      <Select aria-label="Add approval step" className="h-8 w-40" value="" onChange={(e) => e.target.value && update(key, [...chain, e.target.value as ApproverType])} options={unused.map((u) => ({ value: u, label: label(u) }))} placeholder="+ Add step" />
                    </li>
                  )}
                </ol>
              </div>
            );
          })}
        </>
      )}
    </SectionShell>
  );
};

export const IdentityFieldsSection = () => {
  const { settings, value: v, setValue, save } = useSection('identityFields');
  const [newLabel, setNewLabel] = useState('');
  const add = () => {
    if (!v || !newLabel.trim()) return;
    const key = newLabel
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+(.)/g, (_m, c: string) => c.toUpperCase())
      .replace(/[^a-zA-Z0-9]/g, '')
      .replace(/^[^a-z]+/, '')
      .slice(0, 30);
    if (key.length < 2 || v.some((f) => f.key === key)) {
      toast.error('Choose a different, unique name');
      return;
    }
    setValue([...v, { key, label: newLabel.trim(), enabled: true, required: false }]);
    setNewLabel('');
  };
  return (
    <SectionShell loading={!v} error={settings.error} onRetry={() => settings.refetch()} onSave={() => v && save.mutate(v)} saving={save.isPending}>
      {v && (
        <>
          <p className="text-sm text-muted">Identity numbers (e.g. PAN, Aadhaar, passport, tax ID) are stored encrypted and shown masked to users without access to sensitive data.</p>
          <ul className="divide-y divide-line rounded-lg border border-line">
            {v.map((f, i) => (
              <li key={f.key} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <span>
                  <span className="block text-sm font-medium text-fg">{f.label}</span>
                  <span className="block font-mono text-xs text-muted">{f.key}</span>
                </span>
                <span className="flex items-center gap-5 text-sm">
                  <label className="flex items-center gap-2">
                    Enabled <Switch checked={f.enabled} label={`${f.label} enabled`} onChange={(enabled) => setValue(v.map((x, j) => (j === i ? { ...x, enabled } : x)))} />
                  </label>
                  <label className="flex items-center gap-2">
                    Required <Switch checked={f.required} label={`${f.label} required`} onChange={(required) => setValue(v.map((x, j) => (j === i ? { ...x, required } : x)))} />
                  </label>
                </span>
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <Input aria-label="New identity field" placeholder="e.g. National ID" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), add())} />
            <Button variant="outline" icon={<Plus className="h-4 w-4" />} onClick={add}>
              Add
            </Button>
          </div>
        </>
      )}
    </SectionShell>
  );
};

export const EmailSection = () => {
  const status = useQuery({ queryKey: ['organization', 'email-status'], queryFn: () => get<{ configured: boolean; ok: boolean; error?: string }>('/organization/email-status') });
  const test = useMutation({ mutationFn: () => post<{ sentTo: string }>('/organization/test-email'), onSuccess: (r) => toast.success(`Test email queued to ${r.data.sentTo}`) });
  const { settings, value: v, setValue, save } = useSection('notifications');
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="Delivery" description="SMTP is configured by your administrator through server environment variables (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, EMAIL_FROM)." />
        <CardBody className="flex flex-wrap items-center justify-between gap-4">
          {status.isLoading ? (
            <Skeleton className="h-6 w-48" />
          ) : status.data?.configured && status.data.ok ? (
            <span className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-400"><CheckCircle2 className="h-5 w-5" /> SMTP connected</span>
          ) : status.data?.configured ? (
            <span className="flex items-center gap-2 text-sm text-red-600"><XCircle className="h-5 w-5" /> SMTP configured but unreachable: {status.data.error}</span>
          ) : (
            <span className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-400"><XCircle className="h-5 w-5" /> SMTP not configured — emails are rendered and logged but not delivered.</span>
          )}
          <Button variant="outline" icon={<Mail className="h-4 w-4" />} loading={test.isPending} onClick={() => test.mutate()}>
            Send test email
          </Button>
        </CardBody>
      </Card>
      <SectionShell loading={!v} error={settings.error} onRetry={() => settings.refetch()} onSave={() => v && save.mutate(v)} saving={save.isPending}>
        {v && (
          <>
            <FormField label="Document expiry reminder (days before)">
              {({ id }) => <Input id={id} type="number" min={1} max={180} className="max-w-40" value={v.documentExpiryDays} onChange={(e) => setValue({ ...v, documentExpiryDays: Number(e.target.value) })} />}
            </FormField>
            <ToggleRow title="Birthday reminders" description="Notify HR and managers about birthdays." checked={v.birthdayReminders} onChange={(birthdayReminders) => setValue({ ...v, birthdayReminders })} />
            <ToggleRow title="Work anniversary reminders" checked={v.anniversaryReminders} onChange={(anniversaryReminders) => setValue({ ...v, anniversaryReminders })} />
          </>
        )}
      </SectionShell>
    </div>
  );
};

export const SecurityPolicySection = () => {
  const { settings, value: v, setValue, save } = useSection('security');
  return (
    <SectionShell loading={!v} error={settings.error} onRetry={() => settings.refetch()} onSave={() => v && save.mutate(v)} saving={save.isPending}>
      {v && (
        <FormGrid>
          <FormField label="Failed sign-ins before lockout" hint="Accounts lock for 15 minutes.">
            {({ id }) => <Input id={id} type="number" min={3} max={20} value={v.maxLoginAttempts} onChange={(e) => setValue({ ...v, maxLoginAttempts: Number(e.target.value) })} />}
          </FormField>
          <FormField label="Session timeout (minutes)">
            {({ id }) => <Input id={id} type="number" min={5} max={1440} value={v.sessionTimeoutMinutes} onChange={(e) => setValue({ ...v, sessionTimeoutMinutes: Number(e.target.value) })} />}
          </FormField>
        </FormGrid>
      )}
    </SectionShell>
  );
};

interface Integration {
  key: string;
  name: string;
  category: string;
  description: string;
  capabilities: string[];
  status: 'AVAILABLE' | 'NOT_CONFIGURED';
}

export const IntegrationsSection = () => {
  const list = useQuery({ queryKey: ['organization', 'integrations'], queryFn: () => get<Integration[]>('/organization/integrations') });
  if (list.isLoading) return <Skeleton className="h-64" />;
  if (list.error) return <ErrorState message={toApiError(list.error).message} onRetry={() => list.refetch()} />;
  return (
    <>
      <p className="mb-4 text-sm text-muted">Stencil exposes integration points for these systems. Each requires a provider implementation and credentials configured by your administrator — nothing is connected until then.</p>
      <div className="grid gap-4 md:grid-cols-2">
        {list.data?.map((i) => (
          <Card key={i.key} className="p-4">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface-3 text-muted">
                <Plug className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium text-fg">{i.name}</p>
                  <Badge tone={i.status === 'AVAILABLE' ? 'green' : 'gray'}>{i.status === 'AVAILABLE' ? 'Available' : 'Not configured'}</Badge>
                </div>
                <p className="mt-1 text-sm text-muted">{i.description}</p>
                <p className="mt-2 text-xs text-subtle">{i.capabilities.join(' · ')}</p>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </>
  );
};
