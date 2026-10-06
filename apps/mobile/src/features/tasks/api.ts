import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { del, get, getPaged, patch, post } from '@/lib/api';
import { useAuth } from '@/lib/auth';

/* Same shapes as the API `task.service.ts`. */

export type TaskStatus = 'TODO' | 'IN_PROGRESS' | 'DONE';
export type TaskPriority = 'LOW' | 'MEDIUM' | 'HIGH';

export interface TaskPerson {
  _id: string;
  employeeId: string;
  firstName: string;
  lastName: string;
  profilePhoto?: string | null;
  departmentId?: { name: string } | null;
  designationId?: { name: string } | null;
}

export interface Task {
  _id: string;
  title: string;
  description?: string;
  priority: TaskPriority;
  dueDate: string | null;
  status: TaskStatus;
  assigneeId: TaskPerson;
  assignedBy: { _id: string; firstName: string; lastName: string } | null;
  assignedByName?: string;
  seenAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  notes: { byName?: string; text: string; at: string }[];
  createdAt: string;
}

export type TaskScope = 'mine' | 'assigned';
export type TaskState = 'open' | 'done';

export const taskKeys = {
  all: ['tasks'] as const,
  list: (scope: TaskScope, state?: TaskState) => ['tasks', 'list', scope, state ?? 'all'] as const,
  unseen: ['tasks', 'unseen'] as const,
  assignable: ['tasks', 'assignable'] as const,
};

export const useTasks = (scope: TaskScope, state?: TaskState, enabled = true) =>
  useQuery({
    queryKey: taskKeys.list(scope, state),
    queryFn: async () => (await getPaged<Task>('/tasks', { scope, state, limit: 100, page: 1 })).data,
    enabled,
  });

/** New tasks I haven't opened yet — polled for the pop-up (new ones show within ~15 s). */
export const useUnseenTasks = (enabled: boolean) =>
  useQuery({ queryKey: taskKeys.unseen, queryFn: () => get<Task[]>('/tasks/unseen'), enabled, refetchInterval: 15_000 });

/** People I can assign tasks to; empty = I can't assign (not a manager / head / HR). */
export const useAssignable = () => {
  const { user } = useAuth();
  return useQuery({ queryKey: taskKeys.assignable, queryFn: () => get<TaskPerson[]>('/tasks/assignable'), enabled: !!user, staleTime: 5 * 60_000 });
};

const useInvalidate = () => {
  const qc = useQueryClient();
  return () => Promise.all([qc.invalidateQueries({ queryKey: taskKeys.all }), qc.invalidateQueries({ queryKey: ['notifications'] })]);
};

export const useSetTaskStatus = () => {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (v: { id: string; status: TaskStatus; note?: string }) => patch<Task>(`/tasks/${v.id}/status`, { status: v.status, note: v.note }),
    onSuccess: invalidate,
  });
};

export const useMarkTasksSeen = () => {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: (id?: string) => post(id ? `/tasks/${id}/seen` : '/tasks/seen'), onSuccess: invalidate });
};

export const useAssignTask = () => {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (v: { title: string; description?: string; assigneeIds: string[]; priority: TaskPriority; dueDate?: string }) => post<Task[]>('/tasks', v),
    onSuccess: invalidate,
  });
};

export const useDeleteTask = () => {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: (id: string) => del(`/tasks/${id}`), onSuccess: invalidate });
};
