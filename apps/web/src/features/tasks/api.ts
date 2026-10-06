import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { TaskCreateInput, WorkTaskPriority, WorkTaskStatus } from '@stencil/shared';
import { del, get, getPaged, patch, post } from '@/lib/api';
import { apiDateKey, fullName, toDateKey } from '@/lib/utils';

export type { WorkTaskPriority, WorkTaskStatus };

export interface TaskPerson {
  _id: string;
  employeeId: string;
  firstName: string;
  lastName: string;
  profilePhoto?: string | null;
  departmentId?: { _id: string; name: string } | null;
  designationId?: { _id: string; name: string } | null;
}

export interface Task {
  _id: string;
  title: string;
  description?: string;
  priority: WorkTaskPriority;
  dueDate: string | null;
  status: WorkTaskStatus;
  assigneeId: TaskPerson | null;
  assignedBy?: { _id: string; firstName: string; lastName: string; avatar?: string | null } | null;
  assignedByName?: string;
  seenAt?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  notes: { byName?: string; text: string; at: string }[];
  createdAt: string;
}

export interface TaskListQuery {
  scope: 'mine' | 'assigned';
  state?: 'open' | 'done';
  page: number;
  limit: number;
}

export const PRIORITY_META: Record<WorkTaskPriority, { label: string; tone: 'red' | 'amber' | 'gray' }> = {
  HIGH: { label: 'High', tone: 'red' },
  MEDIUM: { label: 'Medium', tone: 'amber' },
  LOW: { label: 'Low', tone: 'gray' },
};

export const STATUS_META: Record<WorkTaskStatus, { label: string; tone: 'gray' | 'blue' | 'green' }> = {
  TODO: { label: 'To do', tone: 'gray' },
  IN_PROGRESS: { label: 'In progress', tone: 'blue' },
  DONE: { label: 'Done', tone: 'green' },
};

export const taskKeys = {
  all: ['tasks'] as const,
  assignable: ['tasks', 'assignable'] as const,
  unseen: ['tasks', 'unseen'] as const,
  list: (q: TaskListQuery) => ['tasks', 'list', q] as const,
  detail: (id: string) => ['tasks', 'detail', id] as const,
};

/** People the viewer may assign tasks to. Empty = the viewer cannot assign. */
export const useAssignable = () =>
  useQuery({ queryKey: taskKeys.assignable, queryFn: () => get<TaskPerson[]>('/tasks/assignable'), staleTime: 5 * 60_000 });

export const useTasks = (query: TaskListQuery, enabled = true) =>
  useQuery({ queryKey: taskKeys.list(query), queryFn: () => getPaged<Task>('/tasks', query), placeholderData: keepPreviousData, enabled });

export const useTask = (id: string | null | undefined) =>
  useQuery({ queryKey: taskKeys.detail(id ?? ''), queryFn: () => get<Task>(`/tasks/${id}`), enabled: !!id });

/** Polls every 15 s (like the announcement pop-up) so a newly assigned task pops up almost immediately. */
export const useUnseenTasks = (enabled: boolean) =>
  useQuery({
    queryKey: taskKeys.unseen,
    queryFn: () => get<Task[]>('/tasks/unseen'),
    enabled,
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
    staleTime: 10_000,
  });

const useInvalidate = () => {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: taskKeys.all }),
      // Dashboards and the notification bell reflect task activity.
      qc.invalidateQueries({ queryKey: ['dashboard'] }),
      qc.invalidateQueries({ queryKey: ['notifications'] }),
    ]);
};

export const useCreateTask = () => {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: (input: TaskCreateInput) => post<Task[]>('/tasks', input), onSuccess: invalidate });
};

export const useUpdateTaskStatus = () => {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, ...input }: { id: string; status: WorkTaskStatus; note?: string }) => patch<Task>(`/tasks/${id}/status`, input),
    onSuccess: invalidate,
  });
};

export const useDeleteTask = () => {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: (id: string) => del(`/tasks/${id}`), onSuccess: invalidate });
};

/** Marks one task (or, without an id, all of mine) as seen. Best-effort: never toasts an error. */
export const useMarkTasksSeen = () => {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id?: string) => post<unknown>(id ? `/tasks/${id}/seen` : '/tasks/seen'),
    meta: { silent: true },
    onSuccess: invalidate,
  });
};

export const assignerName = (t: Task) => fullName(t.assignedBy) || t.assignedByName || 'Someone';

/** Due dates are calendar dates (UTC midnight): overdue once today is past it and the task is still open. */
export const isOverdue = (t: Task) => !!t.dueDate && t.status !== 'DONE' && apiDateKey(t.dueDate) < toDateKey(new Date());
