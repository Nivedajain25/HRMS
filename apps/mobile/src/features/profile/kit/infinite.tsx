import { StyleSheet, View } from 'react-native';
import { useInfiniteQuery, type InfiniteData, type QueryKey } from '@tanstack/react-query';
import { Button, Text } from '@/components';
import { getPaged, type Paged, type QueryParams } from '@/lib/api';
import { space } from '@/theme';

/** Paginated list endpoint (`{ data, pagination }`) as an infinite query ("Load more"). */
export const useInfiniteList = <T,>(
  queryKey: QueryKey,
  path: string,
  query: QueryParams,
  { enabled = true, limit = 20 }: { enabled?: boolean; limit?: number } = {},
) =>
  useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam }) => getPaged<T>(path, { ...query, page: pageParam, limit }),
    initialPageParam: 1,
    getNextPageParam: (last: Paged<T>) => (last.pagination.page < last.pagination.totalPages ? last.pagination.page + 1 : undefined),
    enabled,
  });

export const flattenPages = <T,>(data: InfiniteData<Paged<T>> | undefined): T[] => data?.pages.flatMap((p) => p.data) ?? [];

export const totalOf = <T,>(data: InfiniteData<Paged<T>> | undefined) => data?.pages[0]?.pagination.total ?? 0;

/** "Load more" footer for infinite lists. */
export const LoadMore = ({
  hasNextPage,
  isFetchingNextPage,
  onLoadMore,
  shown,
  total,
  noun = 'items',
}: {
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  onLoadMore: () => void;
  shown: number;
  total: number;
  noun?: string;
}) => {
  if (!hasNextPage && shown < 10) return null;
  return (
    <View style={styles.more}>
      <Text size="xs" color="muted" align="center">
        {`Showing ${shown} of ${total} ${noun}`}
      </Text>
      {hasNextPage ? (
        <Button variant="outline" onPress={onLoadMore} loading={isFetchingNextPage} accessibilityLabel={`Load more ${noun}`}>
          Load more
        </Button>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  more: { gap: space(2), alignItems: 'stretch' },
});
