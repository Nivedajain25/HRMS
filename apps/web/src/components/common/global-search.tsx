import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Briefcase, Building2, CalendarDays, FileText, Megaphone, Package, Search, UserRound, BadgeCheck } from 'lucide-react';
import type { SearchResult } from '@stencil/types';
import { get } from '@/lib/api';
import { useDebounce } from '@/hooks/use-debounce';
import { cn } from '@/lib/utils';
import { Modal } from '../ui/overlay';
import { AppIcon } from './app-icon';
import { usePageResults, type PageResult } from './page-search';

const ICONS: Record<SearchResult['type'], typeof Search> = {
  employee: UserRound,
  candidate: Briefcase,
  department: Building2,
  designation: BadgeCheck,
  asset: Package,
  document: FileText,
  leave: CalendarDays,
  announcement: Megaphone,
};
const GROUP_LABEL: Record<SearchResult['type'], string> = {
  employee: 'People',
  candidate: 'Candidates',
  department: 'Departments',
  designation: 'Designations',
  asset: 'Assets',
  document: 'Documents',
  leave: 'Leave requests',
  announcement: 'Announcements',
};

type Item = { kind: 'page'; page: PageResult } | { kind: 'record'; record: SearchResult };

/**
 * Command-palette style global search (Ctrl/⌘ K): pages first ("payslips", "check in", "holidays" jump straight to
 * that page), then matching records (people, documents, leave requests…).
 */
export const GlobalSearch = ({ open, onClose }: { open: boolean; onClose: () => void }) => {
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const debounced = useDebounce(q.trim(), 250);
  const navigate = useNavigate();
  const pages = usePageResults(q.trim());
  const results = useQuery({
    queryKey: ['search', debounced],
    queryFn: () => get<SearchResult[]>('/search', { q: debounced, limit: 6 }),
    enabled: open && debounced.length >= 2,
    staleTime: 15_000,
  });
  const records = debounced.length >= 2 ? (results.data ?? []) : [];
  const items: Item[] = [...pages.map((page) => ({ kind: 'page' as const, page })), ...records.map((record) => ({ kind: 'record' as const, record }))];

  useEffect(() => {
    if (!open) setQ('');
  }, [open]);
  useEffect(() => setActive(0), [q]);

  const go = (item: Item) => {
    onClose();
    navigate(item.kind === 'page' ? item.page.to : item.record.url);
  };

  let lastGroup: string | null = null;
  return (
    <Modal open={open} onClose={onClose} title="Search" size="lg">
      <div className="-mx-5 -mt-4 border-b border-line px-5 py-3">
        <label className="flex items-center gap-3">
          <Search className="h-5 w-5 text-muted" />
          <input
            data-autofocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search pages, people, documents…"
            aria-label="Search"
            className="w-full bg-transparent py-1 text-base outline-none placeholder:text-subtle"
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive((a) => Math.min(a + 1, items.length - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
              } else if (e.key === 'Enter' && items[active]) go(items[active]!);
            }}
          />
        </label>
      </div>
      <div className="-mx-5 min-h-40 px-2 py-2" role="listbox" aria-label="Search results">
        {!q.trim() && (
          <p className="px-3 py-8 text-center text-sm text-muted">Type a page (e.g. “payslips”, “check in”, “holidays”) or search people, documents, leave and announcements.</p>
        )}
        {q.trim() && !items.length && (debounced.length < 2 || !results.isFetching) && <p className="px-3 py-8 text-center text-sm text-muted">No results for “{q.trim()}”.</p>}
        {items.map((item, i) => {
          const group = item.kind === 'page' ? 'Pages' : GROUP_LABEL[item.record.type];
          const header = group !== lastGroup ? group : null;
          lastGroup = group;
          return (
            <div key={item.kind === 'page' ? `page-${item.page.to}` : `${item.record.type}-${item.record.id}`}>
              {header && <p className="px-3 pt-3 pb-1 text-[11px] font-semibold tracking-wider text-subtle uppercase">{header}</p>}
              <button
                type="button"
                role="option"
                aria-selected={i === active}
                onMouseEnter={() => setActive(i)}
                onClick={() => go(item)}
                className={cn('group flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left', i === active && 'bg-surface-3')}
              >
                {item.kind === 'page' ? (
                  <AppIcon icon={item.page.icon} tone={item.page.tone} size="sm" />
                ) : (
                  (() => {
                    const Icon = ICONS[item.record.type] ?? Search;
                    return <Icon className="h-4 w-4 shrink-0 text-muted" />;
                  })()
                )}
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-fg">{item.kind === 'page' ? item.page.label : item.record.title}</span>
                  {item.kind === 'page' ? (
                    <span className="block truncate text-xs text-muted">{item.page.section === 'Menu' ? 'Page' : `${item.page.section} page`}</span>
                  ) : item.record.subtitle ? (
                    <span className="block truncate text-xs text-muted">{item.record.subtitle}</span>
                  ) : null}
                </span>
              </button>
            </div>
          );
        })}
        {debounced.length >= 2 && results.isFetching && <p className="px-3 py-2 text-xs text-muted">Searching records…</p>}
      </div>
    </Modal>
  );
};
