import { Star } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { READ_NOTIFICATION_TTL_HOURS, useStarNotification, type NotificationItem } from './api';

/** ☆ / ★ toggle: a starred notification is kept instead of being deleted 12 hours after it's read. Own notifications only. */
export const StarButton = ({ n, className }: { n: Pick<NotificationItem, '_id' | 'title' | 'starred'>; className?: string }) => {
  const star = useStarNotification();
  const on = !!n.starred;
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className={cn(on && 'text-amber-500 hover:text-amber-600 dark:text-amber-400', className)}
      aria-pressed={on}
      aria-label={on ? `Unstar "${n.title}"` : `Star "${n.title}" to keep it`}
      title={on ? 'Starred: kept. Click to unstar' : `Star to keep it (otherwise it's deleted ${READ_NOTIFICATION_TTL_HOURS} hours after you read it)`}
      disabled={star.isPending}
      onClick={() => star.mutate({ id: n._id, starred: !on })}
    >
      <Star className={cn('h-4 w-4', on && 'fill-current')} />
    </Button>
  );
};
