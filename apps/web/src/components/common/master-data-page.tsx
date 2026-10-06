import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Controller, useForm, type FieldValues, type UseFormReturn } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { z } from 'zod';
import type { Permission } from '@stencil/shared';
import { applyServerErrors, errorAt, FormError, FormField, FormGrid } from '@/components/forms/form';
import { DataTable } from '@/components/tables/data-table';
import { Button } from '@/components/ui/button';
import { IconTitle, PageHeader } from '@/components/ui/display';
import { Checkbox, Input, Select, Textarea, type SelectOption } from '@/components/ui/input';
import { Drawer, Dropdown, useConfirm } from '@/components/ui/overlay';
import { useListParams } from '@/hooks/use-list-params';
import { del, getPaged, patch, post, toApiError } from '@/lib/api';
import { usePermissions } from '@/store/auth';
import { Combobox, EmployeePicker, FilterBar, SearchInput } from './controls';

export interface FieldDef {
  name: string;
  label: string;
  type?: 'text' | 'number' | 'textarea' | 'select' | 'checkbox' | 'date' | 'time' | 'color' | 'employee' | 'multiselect';
  options?: SelectOption[];
  placeholder?: string;
  hint?: string;
  required?: boolean;
  /** Take the full row in the 2-column form grid. */
  wide?: boolean;
  /** Initial label for pickers when editing. */
  selectedLabel?: (row: Record<string, unknown>) => Record<string, string> | undefined;
}

export interface MasterDataPageProps<T extends { _id: string }> {
  resource: string;
  title: string;
  /** Optional icon shown in a tile before the page title. */
  icon?: ReactNode;
  description?: string;
  singular: string;
  schema: z.ZodType<FieldValues, FieldValues>;
  fields: FieldDef[];
  columns: ColumnDef<T, unknown>[];
  managePermission: Permission;
  /** Maps a row to form values when editing. */
  toForm?: (row: T) => Record<string, unknown>;
  defaults?: Record<string, unknown>;
  /** Transform form output before sending. */
  toPayload?: (values: Record<string, unknown>, editing: boolean) => Record<string, unknown>;
  filters?: (set: (patch: Record<string, string | undefined>) => void, params: Record<string, unknown>) => ReactNode;
  deleteLabel?: string;
  deleteMessage?: string;
  headerActions?: ReactNode;
  onRowClick?: (row: T) => void;
  sortFields?: string[];
  /** Extra controls rendered below the form fields (e.g. helpers that fill fields). */
  formExtras?: (form: UseFormReturn<FieldValues>) => ReactNode;
}

/** Standard list + drawer form for simple tenant-scoped resources. */
export function MasterDataPage<T extends { _id: string; name?: string }>(props: MasterDataPageProps<T>) {
  const { resource, title, singular, schema, fields, managePermission, toForm, defaults = {}, toPayload, deleteLabel = 'Archive' } = props;
  const { params, query, set, clear, hasFilters } = useListParams({ sortBy: 'name', sortOrder: 'asc' });
  const qc = useQueryClient();
  const { can } = usePermissions();
  const canManage = can(managePermission);
  const confirm = useConfirm();
  const [editing, setEditing] = useState<T | null | 'new'>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  const list = useQuery({ queryKey: [resource, 'list', query], queryFn: () => getPaged<T>(`/${resource}`, query), placeholderData: keepPreviousData });
  const invalidate = () => qc.invalidateQueries({ queryKey: [resource] });

  const save = useMutation({
    mutationFn: (values: Record<string, unknown>) =>
      editing && editing !== 'new' ? patch<T>(`/${resource}/${editing._id}`, values) : post<T>(`/${resource}`, values),
    meta: { silent: true },
    onSuccess: invalidate,
  });
  const remove = useMutation({ mutationFn: (id: string) => del(`/${resource}/${id}`), onSuccess: invalidate });

  const form = useForm<FieldValues>({ resolver: zodResolver(schema) });
  const { register, control, handleSubmit, reset, formState, setError } = form;

  useEffect(() => {
    if (editing === null) return;
    setServerError(null);
    reset(editing === 'new' ? { ...defaults } : toForm ? toForm(editing) : (editing as unknown as FieldValues));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    const cleaned = Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v === '' ? (editing === 'new' ? undefined : null) : v]).filter(([, v]) => v !== undefined));
    try {
      const res = await save.mutateAsync(toPayload ? toPayload(cleaned, editing !== 'new') : cleaned);
      toast.success(res.message ?? `${singular} saved`);
      setEditing(null);
    } catch (err) {
      setServerError(applyServerErrors(toApiError(err), setError, fields.map((f) => f.name)));
    }
  });

  const onDelete = async (row: T) => {
    const { confirmed } = await confirm({ title: `${deleteLabel} ${row.name ?? singular.toLowerCase()}?`, message: props.deleteMessage, confirmLabel: deleteLabel });
    if (!confirmed) return;
    const res = await remove.mutateAsync(row._id);
    toast.success(res.message ?? `${singular} ${deleteLabel.toLowerCase()}d`);
  };

  const columns = useMemo<ColumnDef<T, unknown>[]>(
    () => [
      ...props.columns,
      ...(canManage
        ? [
            {
              id: 'actions',
              header: '',
              enableHiding: false,
              cell: ({ row }: { row: { original: T } }) => (
                <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
                  <Dropdown
                    label={`Actions for ${row.original.name ?? singular}`}
                    trigger={<span className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-surface-3"><MoreHorizontal className="h-4 w-4" /></span>}
                    items={[
                      { label: 'Edit', icon: <Pencil className="h-4 w-4" />, onSelect: () => setEditing(row.original) },
                      { label: deleteLabel, icon: <Trash2 className="h-4 w-4" />, danger: true, onSelect: () => void onDelete(row.original) },
                    ]}
                  />
                </div>
              ),
            } as ColumnDef<T, unknown>,
          ]
        : []),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [props.columns, canManage],
  );

  const renderField = (f: FieldDef) => {
    const error = errorAt(formState.errors, f.name);
    return (
      <FormField key={f.name} label={f.type === 'checkbox' ? undefined : f.label} error={error} hint={f.hint} required={f.required} className={f.wide || f.type === 'textarea' ? 'sm:col-span-2' : undefined}>
        {({ id, invalid }) => {
          switch (f.type) {
            case 'textarea':
              return <Textarea id={id} aria-invalid={invalid} {...register(f.name)} />;
            case 'select':
              return <Select id={id} aria-invalid={invalid} options={f.options ?? []} placeholder={f.placeholder} {...register(f.name)} />;
            case 'checkbox':
              return <Checkbox id={id} label={f.label} description={f.hint} {...register(f.name)} />;
            case 'color':
              return <Input id={id} type="color" className="h-9 w-20 p-1" {...register(f.name)} />;
            case 'employee':
              return (
                <Controller
                  control={control}
                  name={f.name}
                  render={({ field }) => (
                    <EmployeePicker id={id} value={(field.value as string) ?? null} onChange={(v) => field.onChange(v ?? '')} selectedLabels={editing && editing !== 'new' ? f.selectedLabel?.(editing as unknown as Record<string, unknown>) : undefined} />
                  )}
                />
              );
            case 'multiselect':
              return (
                <Controller
                  control={control}
                  name={f.name}
                  render={({ field }) => <Combobox id={id} multiple options={f.options ?? []} value={(field.value as string[]) ?? []} onChange={(v) => field.onChange(v ?? [])} placeholder={f.placeholder} />}
                />
              );
            default:
              return <Input id={id} type={f.type ?? 'text'} aria-invalid={invalid} placeholder={f.placeholder} step={f.type === 'number' ? 'any' : undefined} {...register(f.name)} />;
          }
        }}
      </FormField>
    );
  };

  return (
    <>
      <PageHeader
        title={props.icon ? <IconTitle icon={props.icon}>{title}</IconTitle> : title}
        description={props.description}
        actions={
          <>
            {props.headerActions}
            {canManage && (
              <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')}>
                Add {singular.toLowerCase()}
              </Button>
            )}
          </>
        }
      />
      <DataTable
        caption={title}
        storageKey={resource}
        columns={columns}
        data={list.data?.data}
        loading={list.isLoading || list.isFetching}
        error={list.error}
        onRetry={() => list.refetch()}
        pagination={list.data?.pagination}
        onPageChange={(page) => set({ page })}
        onLimitChange={(limit) => set({ limit })}
        sorting={{ sortBy: params.sortBy, sortOrder: params.sortOrder }}
        onSortingChange={(s) => set({ sortBy: s.sortBy, sortOrder: s.sortOrder })}
        onRowClick={props.onRowClick ?? (canManage ? (row) => setEditing(row) : undefined)}
        emptyTitle={`No ${title.toLowerCase()} found`}
        emptyDescription={hasFilters(['search']) ? 'Try changing your search.' : canManage ? `Add your first ${singular.toLowerCase()}.` : undefined}
        emptyAction={canManage && !hasFilters(['search']) ? <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')}>Add {singular.toLowerCase()}</Button> : undefined}
        toolbar={
          <FilterBar active={hasFilters(['search'])} onClear={() => clear()}>
            <SearchInput value={params.search} onSearch={(search) => set({ search })} placeholder={`Search ${title.toLowerCase()}…`} />
            {props.filters?.(set, params)}
          </FilterBar>
        }
      />
      <Drawer
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === 'new' ? `New ${singular.toLowerCase()}` : `Edit ${singular.toLowerCase()}`}
        footer={
          <>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button onClick={onSubmit} loading={formState.isSubmitting}>
              Save
            </Button>
          </>
        }
      >
        <form onSubmit={onSubmit} noValidate className="space-y-5">
          <FormError error={serverError} />
          <FormGrid>{fields.map(renderField)}</FormGrid>
          {props.formExtras?.(form)}
        </form>
      </Drawer>
    </>
  );
}
