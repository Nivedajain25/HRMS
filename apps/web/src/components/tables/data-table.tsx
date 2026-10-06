import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type RowSelectionState,
  type SortingState,
  type VisibilityState,
} from '@tanstack/react-table';
import { ArrowDown, ArrowUp, ChevronsUpDown, ChevronLeft, ChevronRight, Columns3 } from 'lucide-react';
import type { Pagination as PaginationInfo } from '@stencil/types';
import { cn } from '@/lib/utils';
import { Button } from '../ui/button';
import { EmptyState, ErrorState, Skeleton } from '../ui/display';
import { Select } from '../ui/input';

export interface DataTableProps<T> {
  columns: ColumnDef<T, unknown>[];
  data: T[] | undefined;
  loading?: boolean;
  error?: Error | null;
  onRetry?: () => void;
  pagination?: PaginationInfo;
  onPageChange?: (page: number) => void;
  onLimitChange?: (limit: number) => void;
  sorting?: { sortBy?: string; sortOrder?: 'asc' | 'desc' };
  onSortingChange?: (sort: { sortBy?: string; sortOrder: 'asc' | 'desc' }) => void;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: ReactNode;
  onRowClick?: (row: T) => void;
  getRowId?: (row: T) => string;
  /** Enables row checkboxes and renders the bulk bar when rows are selected. */
  bulkActions?: (selected: T[], clear: () => void) => ReactNode;
  toolbar?: ReactNode;
  caption?: string;
  storageKey?: string;
}

/**
 * Server-driven data table: pagination/sorting are delegated to the API.
 * Column visibility is remembered per table (localStorage).
 */
export function DataTable<T>({
  columns,
  data,
  loading,
  error,
  onRetry,
  pagination,
  onPageChange,
  onLimitChange,
  sorting,
  onSortingChange,
  emptyTitle = 'No records found',
  emptyDescription = 'Try changing your filters.',
  emptyAction,
  onRowClick,
  getRowId,
  bulkActions,
  toolbar,
  caption,
  storageKey,
}: DataTableProps<T>) {
  const [visibility, setVisibility] = useState<VisibilityState>(() => {
    if (!storageKey) return {};
    try {
      return JSON.parse(localStorage.getItem(`table:${storageKey}`) ?? '{}') as VisibilityState;
    } catch {
      return {};
    }
  });
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [columnMenu, setColumnMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (storageKey) {
      try {
        localStorage.setItem(`table:${storageKey}`, JSON.stringify(visibility));
      } catch {
        /* ignore */
      }
    }
  }, [visibility, storageKey]);

  useEffect(() => {
    if (!columnMenu) return;
    const close = (e: MouseEvent) => !menuRef.current?.contains(e.target as Node) && setColumnMenu(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [columnMenu]);

  // Clear selection when the page of data changes.
  useEffect(() => setRowSelection({}), [data]);

  const sortingState: SortingState = useMemo(
    () => (sorting?.sortBy ? [{ id: sorting.sortBy, desc: sorting.sortOrder === 'desc' }] : []),
    [sorting?.sortBy, sorting?.sortOrder],
  );

  const allColumns = useMemo<ColumnDef<T, unknown>[]>(() => {
    if (!bulkActions) return columns;
    return [
      {
        id: '__select',
        enableSorting: false,
        enableHiding: false,
        header: ({ table }) => (
          <input
            type="checkbox"
            aria-label="Select all rows"
            className="h-4 w-4 accent-brand-600"
            checked={table.getIsAllRowsSelected()}
            onChange={table.getToggleAllRowsSelectedHandler()}
          />
        ),
        cell: ({ row }) => (
          <input
            type="checkbox"
            aria-label="Select row"
            className="h-4 w-4 accent-brand-600"
            checked={row.getIsSelected()}
            onClick={(e) => e.stopPropagation()}
            onChange={row.getToggleSelectedHandler()}
          />
        ),
      },
      ...columns,
    ];
  }, [columns, bulkActions]);

  const table = useReactTable({
    data: data ?? [],
    columns: allColumns,
    getCoreRowModel: getCoreRowModel(),
    manualSorting: true,
    manualPagination: true,
    state: { sorting: sortingState, columnVisibility: visibility, rowSelection },
    onColumnVisibilityChange: setVisibility,
    onRowSelectionChange: setRowSelection,
    enableRowSelection: !!bulkActions,
    getRowId: getRowId ? (row) => getRowId(row) : undefined,
    onSortingChange: (updater) => {
      const next = typeof updater === 'function' ? updater(sortingState) : updater;
      const first = next[0];
      onSortingChange?.({ sortBy: first?.id, sortOrder: first?.desc ? 'desc' : 'asc' });
    },
  });

  const selected = table.getSelectedRowModel().rows.map((r) => r.original);
  const hideable = table.getAllLeafColumns().filter((c) => c.getCanHide() && c.id !== '__select');

  return (
    <div className="card overflow-hidden">
      {(toolbar || hideable.length > 3) && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">{toolbar}</div>
          {hideable.length > 3 && (
            <div className="relative" ref={menuRef}>
              <Button variant="outline" size="sm" icon={<Columns3 className="h-4 w-4" />} onClick={() => setColumnMenu((v) => !v)} aria-expanded={columnMenu}>
                <span className="hidden sm:inline">Columns</span>
              </Button>
              {columnMenu && (
                <div className="animate-scale-in absolute right-0 z-30 mt-1 w-52 rounded-lg border border-line bg-surface p-2 shadow-pop">
                  {hideable.map((col) => (
                    <label key={col.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-surface-3">
                      <input type="checkbox" className="accent-brand-600" checked={col.getIsVisible()} onChange={col.getToggleVisibilityHandler()} />
                      {typeof col.columnDef.header === 'string' ? col.columnDef.header : col.id}
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {bulkActions && selected.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 border-b border-line bg-brand-50 px-4 py-2 text-sm dark:bg-brand-500/10">
          <span className="font-medium text-brand-700 dark:text-brand-300">{selected.length} selected</span>
          {bulkActions(selected, () => setRowSelection({}))}
        </div>
      )}

      {error ? (
        <ErrorState message={error.message} onRetry={onRetry} />
      ) : (
        <div className="scrollbar-thin overflow-x-auto">
          <table className="w-full text-sm">
            {caption && <caption className="sr-only">{caption}</caption>}
            <thead className="bg-surface-2">
              {table.getHeaderGroups().map((hg) => (
                <tr key={hg.id}>
                  {hg.headers.map((header) => {
                    const canSort = header.column.getCanSort() && !!onSortingChange && header.column.columnDef.enableSorting === true;
                    const dir = header.column.getIsSorted();
                    return (
                      <th
                        key={header.id}
                        scope="col"
                        aria-sort={dir ? (dir === 'desc' ? 'descending' : 'ascending') : undefined}
                        className="border-b border-line px-4 py-2.5 text-left text-xs font-semibold tracking-wide whitespace-nowrap text-muted uppercase"
                      >
                        {header.isPlaceholder ? null : canSort ? (
                          <button type="button" onClick={header.column.getToggleSortingHandler()} className="inline-flex items-center gap-1 uppercase hover:text-fg">
                            {flexRender(header.column.columnDef.header, header.getContext())}
                            {dir === 'asc' ? <ArrowUp className="h-3 w-3" /> : dir === 'desc' ? <ArrowDown className="h-3 w-3" /> : <ChevronsUpDown className="h-3 w-3 opacity-50" />}
                          </button>
                        ) : (
                          flexRender(header.column.columnDef.header, header.getContext())
                        )}
                      </th>
                    );
                  })}
                </tr>
              ))}
            </thead>
            <tbody className="divide-y divide-line">
              {loading && !data?.length
                ? Array.from({ length: 6 }).map((_, i) => (
                    <tr key={i}>
                      {table.getVisibleLeafColumns().map((c) => (
                        <td key={c.id} className="px-4 py-3">
                          <Skeleton className="h-4 w-full max-w-40" />
                        </td>
                      ))}
                    </tr>
                  ))
                : table.getRowModel().rows.map((row) => (
                    <tr
                      key={row.id}
                      onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                      onKeyDown={onRowClick ? (e) => e.key === 'Enter' && e.target === e.currentTarget && onRowClick(row.original) : undefined}
                      tabIndex={onRowClick ? 0 : undefined}
                      className={cn('transition-colors', onRowClick && 'cursor-pointer hover:bg-surface-2 focus:bg-surface-2 focus:outline-none', row.getIsSelected() && 'bg-brand-50/60 dark:bg-brand-500/5')}
                    >
                      {row.getVisibleCells().map((cell) => (
                        <td key={cell.id} className="px-4 py-3 align-middle whitespace-nowrap text-fg-2">
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </td>
                      ))}
                    </tr>
                  ))}
            </tbody>
          </table>
          {!loading && !data?.length && <EmptyState title={emptyTitle} description={emptyDescription} action={emptyAction} />}
        </div>
      )}

      {pagination && !error && (data?.length ?? 0) > 0 && (
        <Pagination pagination={pagination} onPageChange={onPageChange} onLimitChange={onLimitChange} loading={loading} />
      )}
    </div>
  );
}

export const Pagination = ({
  pagination,
  onPageChange,
  onLimitChange,
  loading,
}: {
  pagination: PaginationInfo;
  onPageChange?: (page: number) => void;
  onLimitChange?: (limit: number) => void;
  loading?: boolean;
}) => {
  const { page, limit, total, totalPages } = pagination;
  const from = total === 0 ? 0 : (page - 1) * limit + 1;
  const to = Math.min(page * limit, total);
  return (
    <nav aria-label="Pagination" className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3 text-sm text-muted">
      <div className="flex items-center gap-3">
        <span>
          {from}–{to} of {total}
        </span>
        {onLimitChange && (
          <Select
            aria-label="Rows per page"
            className="h-8 w-20"
            value={String(limit)}
            onChange={(e) => onLimitChange(Number(e.target.value))}
            options={[10, 20, 50, 100].map((n) => ({ value: String(n), label: String(n) }))}
          />
        )}
      </div>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="icon-sm" aria-label="Previous page" disabled={page <= 1 || loading} onClick={() => onPageChange?.(page - 1)}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="tabular-nums">
          Page {page} of {totalPages}
        </span>
        <Button variant="outline" size="icon-sm" aria-label="Next page" disabled={page >= totalPages || loading} onClick={() => onPageChange?.(page + 1)}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </nav>
  );
};
