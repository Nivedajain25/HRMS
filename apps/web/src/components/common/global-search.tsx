import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Briefcase, Building2, CalendarDays, FileText, Megaphone, Package, Search, UserRound, BadgeCheck } from 'lucide-react';
import type { SearchResult } from '@stencil/types';
import { get } from '@/lib/api';
import { useDebounce } from '@/hooks/use-debounce';
import { cn } from '@/lib/utils';
import { Modal } from '../ui/overlay';

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

/** Command-palette style global search (Ctrl/⌘ K). */
export const GlobalSearch = ({ open, onClose }: { open: boolean; onClose: () => void }) => {
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const debounced = useDebounce(q.trim(), 250);
  const navigate = useNavigate();
  const results = useQuery({
    queryKey: ['search', debounced],
    queryFn: () => get<SearchResult[]>('/search', { q: debounced, limit: 6 }),
    enabled: open && debounced.length >= 2,
    staleTime: 15_000,
  });
  const items = results.data ?? [];

  useEffect(() => {
    if (!open) setQ('');
  }, [open]);
  useEffect(() => setActive(0), [debounced]);

  const go = (r: SearchResult) => {
    onClose();
    navigate(r.url);
  };

  let lastType: string | null = null;
  return (
    <Modal open={open} onClose={onClose} title="Search" size="lg">
      <div className="-mx-5 -mt-4 border-b border-line px-5 py-3">
        <label className="flex items-center gap-3">
          <Search className="h-5 w-5 text-muted" />
          <input
            data-autofocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Type at least 2 characters…"
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
        {debounced.length < 2 && <p className="px-3 py-8 text-center text-sm text-muted">Search employees, candidates, departments, assets, documents, leave and announcements.</p>}
        {debounced.length >= 2 && results.isFetching && !items.length && <p className="px-3 py-8 text-center text-sm text-muted">Searching…</p>}
        {debounced.length >= 2 && !results.isFetching && !items.length && <p className="px-3 py-8 text-center text-sm text-muted">No results for “{debounced}”.</p>}
        {items.map((r, i) => {
          const Icon = ICONS[r.type] ?? Search;
          const header = r.type !== lastType ? GROUP_LABEL[r.type] : null;
          lastType = r.type;
          return (
            <div key={`${r.type}-${r.id}`}>
              {header && <p className="px-3 pt-3 pb-1 text-[11px] font-semibold tracking-wider text-subtle uppercase">{header}</p>}
              <button
                type="button"
                role="option"
                aria-selected={i === active}
                onMouseEnter={() => setActive(i)}
                onClick={() => go(r)}
                className={cn('flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left', i === active && 'bg-surface-3')}
              >
                <Icon className="h-4 w-4 shrink-0 text-muted" />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-fg">{r.title}</span>
                  {r.subtitle && <span className="block truncate text-xs text-muted">{r.subtitle}</span>}
                </span>
              </button>
            </div>
          );
        })}
      </div>
    </Modal>
  );
};
