import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ClipboardList } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Avatar } from '@/components/ui/display';
import { Modal } from '@/components/ui/overlay';
import { timeAgo } from '@/lib/utils';
import { usePermissions } from '@/store/auth';
import { useOtherPopupOpen, useRegisterPopup } from '@/store/popups';
import { assignerName, useMarkTasksSeen, useUnseenTasks } from '../api';
import { DueLabel, PriorityBadge } from './task-ui';

const POPUP_ID = 'tasks';

/**
 * Pops up tasks newly assigned to the viewer (polled every 15 s, like the announcement pop-up). Waits while
 * another pop-up is on screen. "View tasks" and "Got it" both mark them seen so each one shows only once.
 */
export const TaskPopup = () => {
  const { hasEmployee } = usePermissions();
  const unseen = useUnseenTasks(hasEmployee);
  const markSeen = useMarkTasksSeen();
  const navigate = useNavigate();
  // Hide immediately after a choice, without waiting for the refetch.
  const [handled, setHandled] = useState<string[]>([]);
  const otherOpen = useOtherPopupOpen(POPUP_ID);

  const tasks = useMemo(() => (unseen.data ?? []).filter((t) => !handled.includes(t._id)), [unseen.data, handled]);
  const showing = hasEmployee && tasks.length > 0 && !otherOpen;
  useRegisterPopup(POPUP_ID, showing);

  const dismiss = () => {
    setHandled((h) => [...h, ...tasks.map((t) => t._id)]);
    markSeen.mutate(undefined);
  };
  const view = () => {
    dismiss();
    navigate(tasks.length === 1 ? `/tasks?id=${tasks[0]!._id}` : '/tasks');
  };

  if (!showing) return null;
  const single = tasks.length === 1;

  return (
    <Modal
      open
      onClose={dismiss}
      size="md"
      title={
        <span className="flex items-center gap-2">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300">
            <ClipboardList className="h-4 w-4" aria-hidden />
          </span>
          <span className="min-w-0">{single ? 'New task assigned' : `${tasks.length} new tasks assigned`}</span>
        </span>
      }
      description={single ? 'You have a new task.' : 'You have new tasks.'}
      footer={
        <>
          <Button variant="outline" onClick={view}>
            View tasks
          </Button>
          <Button onClick={dismiss}>Got it</Button>
        </>
      }
    >
      <ul className="space-y-3">
        {tasks.slice(0, 5).map((t) => (
          <li key={t._id} className="rounded-xl border border-line p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <p className="min-w-0 font-semibold break-words text-fg">{t.title}</p>
              <PriorityBadge priority={t.priority} />
            </div>
            {t.description && <p className="mt-1 line-clamp-3 text-sm whitespace-pre-line text-fg-2">{t.description}</p>}
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
              <span className="flex items-center gap-1.5">
                <Avatar name={assignerName(t)} src={t.assignedBy?.avatar} size="xs" />
                <span>
                  From <span className="font-medium text-fg-2">{assignerName(t)}</span> · {timeAgo(t.createdAt)}
                </span>
              </span>
              <DueLabel task={t} />
            </div>
          </li>
        ))}
      </ul>
      {tasks.length > 5 && <p className="mt-3 text-center text-sm text-muted">and {tasks.length - 5} more</p>}
    </Modal>
  );
};
