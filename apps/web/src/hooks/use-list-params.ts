import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

export interface ListParams {
  page: number;
  limit: number;
  search?: string;
  sortBy?: string;
  sortOrder: 'asc' | 'desc';
  [filter: string]: string | number | undefined;
}

/**
 * List state (page, limit, search, sort, filters) kept in the URL so views are
 * shareable and survive refresh/back navigation.
 */
export const useListParams = (defaults: Partial<ListParams> = {}) => {
  const [searchParams, setSearchParams] = useSearchParams();

  const params = useMemo<ListParams>(() => {
    const out: ListParams = {
      page: 1,
      limit: 20,
      sortOrder: 'desc',
      ...defaults,
    } as ListParams;
    for (const [k, v] of searchParams.entries()) {
      if (k === 'page' || k === 'limit') out[k] = Math.max(1, Number(v) || 1);
      else if (k === 'sortOrder') out.sortOrder = v === 'asc' ? 'asc' : 'desc';
      else out[k] = v;
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  /** Sets values; any change other than `page` resets to page 1. */
  const set = useCallback(
    (patch: Partial<Record<keyof ListParams | string, string | number | undefined>>) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [k, v] of Object.entries(patch)) {
            if (v === undefined || v === '' || v === null) next.delete(k);
            else next.set(k, String(v));
          }
          if (!('page' in patch)) next.delete('page');
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const clear = useCallback((keep: string[] = []) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams();
        for (const k of keep) {
          const v = prev.get(k);
          if (v) next.set(k, v);
        }
        return next;
      },
      { replace: true },
    );
  }, [setSearchParams]);

  const hasFilters = (keys: string[]) => keys.some((k) => searchParams.has(k));

  /** Query object for the API (drops empty values). */
  const query = useMemo(() => Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== '')), [params]);

  return { params, query, set, clear, hasFilters };
};
