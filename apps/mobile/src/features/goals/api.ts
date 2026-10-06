import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getPaged, post } from '@/lib/api';

/* Subset of the web `features/performance/api.ts` goal shape. */

export type GoalStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';

export interface Goal {
  _id: string;
  title: string;
  description?: string;
  category: string;
  progress: number;
  dueDate?: string | null;
  status: GoalStatus;
  target?: string;
  managerId?: { firstName: string; lastName: string } | null;
}

export const goalKeys = { mine: ['performance', 'goals', 'mine'] as const };

/** My goals (all statuses), newest cycle first as returned by the API. */
export const useMyGoals = (enabled: boolean) =>
  useQuery({
    queryKey: goalKeys.mine,
    queryFn: async () => (await getPaged<Goal>('/performance/goals', { scope: 'me', limit: 100, page: 1 })).data,
    enabled,
  });

/** Record progress (0–100) with an optional note; 100 or COMPLETED marks it done. */
export const useUpdateGoalProgress = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; progress: number; status?: GoalStatus; note?: string }) =>
      post<Goal>(`/performance/goals/${v.id}/progress`, { progress: v.progress, status: v.status, note: v.note }),
    onSuccess: () =>
      Promise.all([qc.invalidateQueries({ queryKey: ['performance'] }), qc.invalidateQueries({ queryKey: ['dashboard'] })]),
  });
};
