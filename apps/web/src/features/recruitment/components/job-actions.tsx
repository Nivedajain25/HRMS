import { toast } from 'sonner';
import { Archive, CirclePause, CirclePlay, Pencil, Send, Trash2 } from 'lucide-react';
import type { DropdownItem } from '@/components/ui/overlay';
import { useConfirm } from '@/components/ui/overlay';
import { usePermissions } from '@/store/auth';
import { useDeleteJob, useJobStatus, type JobOpening, type JobStatus } from '../api';
import { JOB_ACTIONS } from './shared';

const ICONS: Record<JobStatus, typeof Send> = { OPEN: CirclePlay, ON_HOLD: CirclePause, CLOSED: Archive, DRAFT: Send };

/** Status changes (open / hold / close / reopen) and deletion with confirmations. */
export const useJobActions = () => {
  const confirm = useConfirm();
  const status = useJobStatus();
  const remove = useDeleteJob();
  const { can } = usePermissions();
  const canUpdate = can('recruitment:update');

  const changeStatus = async (job: JobOpening, to: JobStatus) => {
    if (to === 'CLOSED') {
      const { confirmed } = await confirm({
        title: `Close ${job.title}?`,
        message: 'No new candidates can be added. Candidates already in the pipeline are kept and the job can be reopened later.',
        confirmLabel: 'Close job',
      });
      if (!confirmed) return;
    }
    if (to === 'ON_HOLD') {
      const { confirmed } = await confirm({ title: `Put ${job.title} on hold?`, message: 'The job stops accepting new candidates until hiring is resumed.', confirmLabel: 'Put on hold', tone: 'primary' });
      if (!confirmed) return;
    }
    try {
      await status.mutateAsync({ id: job._id, status: to });
    } catch {
      return; // error toasted globally
    }
    toast.success(to === 'OPEN' ? (job.status === 'DRAFT' ? 'Job published' : 'Job reopened') : to === 'CLOSED' ? 'Job closed' : 'Job put on hold');
  };

  const deleteJob = async (job: JobOpening) => {
    const hasCandidates = job.candidateTotal > 0;
    const { confirmed } = await confirm({
      title: `Delete ${job.title}?`,
      message: hasCandidates ? 'This job has candidates, so it will be closed instead of deleted to keep their history.' : 'The job opening will be permanently removed.',
      confirmLabel: hasCandidates ? 'Close job' : 'Delete job',
    });
    if (!confirmed) return false;
    try {
      const res = await remove.mutateAsync(job._id);
      toast.success(res.data.deleted ? 'Job opening deleted' : 'Job opening closed');
      return res.data.deleted;
    } catch {
      return false; // error toasted globally
    }
  };

  const menuItems = (job: JobOpening, onEdit: () => void, onDeleted?: () => void): DropdownItem[] => [
    { label: 'Edit', icon: <Pencil className="h-4 w-4" />, hidden: !canUpdate, onSelect: onEdit },
    ...JOB_ACTIONS[job.status].map((a) => {
      const Icon = ICONS[a.to];
      return { label: a.label, icon: <Icon className="h-4 w-4" />, hidden: !canUpdate, onSelect: () => void changeStatus(job, a.to) };
    }),
    {
      label: 'Delete',
      icon: <Trash2 className="h-4 w-4" />,
      danger: true,
      hidden: !canUpdate || job.status === 'CLOSED',
      onSelect: () => void deleteJob(job).then((deleted) => deleted && onDeleted?.()),
    },
  ];

  return { changeStatus, deleteJob, menuItems, pending: status.isPending || remove.isPending, canUpdate };
};
