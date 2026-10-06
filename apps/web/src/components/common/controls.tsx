import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, ChevronsUpDown, FileUp, Search, X } from 'lucide-react';
import { get } from '@/lib/api';
import { useDebounce } from '@/hooks/use-debounce';
import { cn, formatBytes, fullName } from '@/lib/utils';
import { Button } from '../ui/button';
import { Avatar } from '../ui/display';
import { Input, controlClass } from '../ui/input';

/* ---------------------------- SearchInput ---------------------------- */

/** Debounced search box; calls `onSearch` 300ms after typing stops. */
export const SearchInput = ({
  value,
  onSearch,
  placeholder = 'Search…',
  className,
}: {
  value?: string;
  onSearch: (v: string) => void;
  placeholder?: string;
  className?: string;
}) => {
  const [text, setText] = useState(value ?? '');
  const debounced = useDebounce(text, 300);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    onSearch(debounced.trim());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);
  return (
    <div className={cn('w-full sm:w-72', className)}>
      <Input
        type="search"
        aria-label={placeholder}
        placeholder={placeholder}
        value={text}
        onChange={(e) => setText(e.target.value)}
        leftIcon={<Search className="h-4 w-4" />}
      />
    </div>
  );
};

/* ----------------------------- FilterBar ----------------------------- */

export const FilterBar = ({ children, onClear, active }: { children: ReactNode; onClear?: () => void; active?: boolean }) => (
  <div className="flex flex-wrap items-center gap-2">
    {children}
    {active && onClear && (
      <Button variant="ghost" size="sm" onClick={onClear} icon={<X className="h-4 w-4" />}>
        Clear
      </Button>
    )}
  </div>
);

/* ----------------------------- Combobox ------------------------------ */

export interface ComboOption {
  value: string;
  label: string;
  description?: string;
  image?: string | null;
}

/**
 * Accessible searchable single/multi select. Options can be static or
 * loaded via `loadOptions(search)`.
 */
export const Combobox = ({
  value,
  onChange,
  options: staticOptions,
  loadOptions,
  placeholder = 'Select…',
  multiple,
  disabled,
  id,
  invalid,
  selectedLabels,
  showAvatars,
}: {
  value: string | string[] | null | undefined;
  onChange: (v: string | string[] | null) => void;
  options?: ComboOption[];
  loadOptions?: (search: string) => Promise<ComboOption[]>;
  placeholder?: string;
  multiple?: boolean;
  disabled?: boolean;
  id?: string;
  invalid?: boolean;
  /** Labels for pre-selected values that may not be in the loaded options. */
  selectedLabels?: Record<string, string>;
  showAvatars?: boolean;
}) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [active, setActive] = useState(0);
  const debounced = useDebounce(search, 250);
  const ref = useRef<HTMLDivElement>(null);
  const listId = useId();
  const labels = useRef<Record<string, string>>({ ...(selectedLabels ?? {}) });

  const remote = useQuery({
    queryKey: ['combobox', loadOptions?.toString(), debounced],
    queryFn: () => loadOptions!(debounced),
    enabled: !!loadOptions && open,
    staleTime: 30_000,
  });
  const options = (loadOptions ? remote.data : staticOptions?.filter((o) => o.label.toLowerCase().includes(search.toLowerCase()))) ?? [];
  for (const o of options) labels.current[o.value] = o.label;
  if (selectedLabels) Object.assign(labels.current, selectedLabels);
  for (const o of staticOptions ?? []) labels.current[o.value] = o.label;

  const selected = Array.isArray(value) ? value : value ? [value] : [];

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  useEffect(() => setActive(0), [debounced, open]);

  const choose = (v: string) => {
    if (multiple) {
      onChange(selected.includes(v) ? selected.filter((s) => s !== v) : [...selected, v]);
    } else {
      onChange(v);
      setOpen(false);
      setSearch('');
    }
  };

  return (
    <div ref={ref} className="relative">
      <button
        id={id}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-invalid={invalid || undefined}
        onClick={() => setOpen((o) => !o)}
        className={cn(controlClass, 'flex min-h-9 items-center justify-between gap-2 py-1.5 text-left')}
      >
        <span className="flex min-w-0 flex-1 flex-wrap gap-1">
          {selected.length === 0 && <span className="text-subtle">{placeholder}</span>}
          {!multiple && selected[0] && <span className="truncate">{labels.current[selected[0]] ?? 'Selected'}</span>}
          {multiple &&
            selected.map((s) => (
              <span key={s} className="inline-flex items-center gap-1 rounded bg-surface-3 px-1.5 py-0.5 text-xs">
                {labels.current[s] ?? s}
                <span
                  role="button"
                  tabIndex={0}
                  aria-label={`Remove ${labels.current[s] ?? s}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    choose(s);
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && choose(s)}
                  className="text-muted hover:text-fg"
                >
                  <X className="h-3 w-3" />
                </span>
              </span>
            ))}
        </span>
        <span className="flex items-center gap-1">
          {!multiple && selected[0] && !disabled && (
            <span
              role="button"
              tabIndex={0}
              aria-label="Clear selection"
              onClick={(e) => {
                e.stopPropagation();
                onChange(null);
              }}
              onKeyDown={(e) => e.key === 'Enter' && onChange(null)}
              className="text-subtle hover:text-fg"
            >
              <X className="h-3.5 w-3.5" />
            </span>
          )}
          <ChevronsUpDown className="h-4 w-4 text-subtle" />
        </span>
      </button>
      {open && (
        <div className="animate-scale-in absolute z-40 mt-1 w-full min-w-56 rounded-lg border border-line bg-surface shadow-pop">
          <div className="border-b border-line p-2">
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search…"
              aria-label="Search options"
              aria-controls={listId}
              aria-activedescendant={options[active] ? `${listId}-${active}` : undefined}
              className="w-full rounded-md bg-surface-2 px-2.5 py-1.5 text-sm outline-none"
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setActive((a) => Math.min(a + 1, options.length - 1));
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setActive((a) => Math.max(a - 1, 0));
                } else if (e.key === 'Enter' && options[active]) {
                  e.preventDefault();
                  choose(options[active]!.value);
                } else if (e.key === 'Escape') setOpen(false);
              }}
            />
          </div>
          <ul id={listId} role="listbox" aria-multiselectable={multiple || undefined} className="scrollbar-thin max-h-64 overflow-y-auto p-1">
            {remote.isFetching && !options.length && <li className="px-3 py-2 text-sm text-muted">Loading…</li>}
            {!remote.isFetching && !options.length && <li className="px-3 py-2 text-sm text-muted">No matches</li>}
            {options.map((o, i) => {
              const isSel = selected.includes(o.value);
              return (
                <li
                  key={o.value}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={isSel}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(o.value)}
                  className={cn('flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm', i === active && 'bg-surface-3')}
                >
                  {showAvatars && <Avatar name={o.label} src={o.image} size="xs" />}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-fg">{o.label}</span>
                    {o.description && <span className="block truncate text-xs text-muted">{o.description}</span>}
                  </span>
                  {isSel && <Check className="h-4 w-4 text-brand-600" />}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
};

interface DirectoryEntry {
  _id: string;
  employeeId: string;
  firstName: string;
  lastName: string;
  profilePhoto?: string | null;
  designationId?: { name: string } | null;
  departmentId?: { name: string } | null;
}

export const loadEmployeeOptions = async (search: string): Promise<ComboOption[]> => {
  const rows = await get<DirectoryEntry[]>('/employees/directory', { search: search || undefined, limit: 30 });
  return rows.map((e) => ({
    value: e._id,
    label: fullName(e),
    description: [e.employeeId, e.designationId?.name, e.departmentId?.name].filter(Boolean).join(' · '),
    image: e.profilePhoto,
  }));
};

/** Employee picker backed by the people directory. */
export const EmployeePicker = (props: Omit<Parameters<typeof Combobox>[0], 'loadOptions' | 'options'>) => (
  <Combobox placeholder="Select employee…" showAvatars {...props} loadOptions={loadEmployeeOptions} />
);

/* ----------------------------- FileUpload ---------------------------- */

export const FileUpload = ({
  onFile,
  accept = '.pdf,.png,.jpg,.jpeg,.webp,.docx,.xlsx',
  maxMb = 10,
  file,
  label = 'Upload a file',
  hint,
  id,
}: {
  onFile: (file: File | null) => void;
  accept?: string;
  maxMb?: number;
  file?: File | null;
  label?: string;
  hint?: string;
  id?: string;
}) => {
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const pick = (f: File | undefined) => {
    if (!f) return;
    if (f.size > maxMb * 1024 * 1024) {
      setError(`File must be under ${maxMb} MB`);
      return;
    }
    setError(null);
    onFile(f);
  };
  return (
    <div>
      {file ? (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-line bg-surface-2 px-3 py-2.5 text-sm">
          <span className="flex min-w-0 items-center gap-2">
            <FileUp className="h-4 w-4 shrink-0 text-brand-600" />
            <span className="truncate font-medium">{file.name}</span>
            <span className="shrink-0 text-muted">{formatBytes(file.size)}</span>
          </span>
          <Button variant="ghost" size="icon-sm" aria-label="Remove file" onClick={() => onFile(null)}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      ) : (
        <label
          htmlFor={id}
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            pick(e.dataTransfer.files[0]);
          }}
          className={cn(
            'flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-4 py-6 text-center transition-colors',
            drag ? 'border-brand-500 bg-brand-50 dark:bg-brand-500/10' : 'border-line-strong hover:border-brand-400 hover:bg-surface-2',
          )}
        >
          <FileUp className="mb-2 h-6 w-6 text-muted" />
          <span className="text-sm font-medium text-fg">{label}</span>
          <span className="mt-0.5 text-xs text-muted">{hint ?? `Drag & drop or click · max ${maxMb} MB`}</span>
          <input ref={inputRef} id={id} type="file" accept={accept} className="sr-only" onChange={(e) => pick(e.target.files?.[0])} />
        </label>
      )}
      {error && (
        <p role="alert" className="mt-1 text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
};
