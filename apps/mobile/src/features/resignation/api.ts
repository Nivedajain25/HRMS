import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { OffboardingCreateInput, OffboardingStatus } from '@stencil/shared';
import { get, getPaged, post } from '@/lib/api';

/** The employee's own exit (resignation) record — the web's offboarding, seen from the employee's side. */
export interface Resignation {
  _id: string;
  exitType: string;
  reason: string;
  requestDate: string;
  lastWorkingDate: string;
  status: OffboardingStatus;
  timeline: { status: OffboardingStatus; note?: string; at: string }[];
  createdAt: string;
}

export interface ResignationDetail extends Resignation {
  /** The workflow's steps in order (Exit request → … → Completed). */
  steps: OffboardingStatus[];
  /** Still early enough to withdraw. */
  canCancel: boolean;
}

const keys = {
  // Under the web's 'offboarding' root, so the same invalidations apply.
  mine: ['offboarding', 'mine'] as const,
  detail: (id: string) => ['offboarding', 'detail', id] as const,
};

/** My resignation in progress (null when there is none). */
export const useMyResignation = (enabled: boolean) =>
  useQuery({
    queryKey: keys.mine,
    queryFn: async () => (await getPaged<Resignation>('/offboarding', { scope: 'me', status: 'ACTIVE', limit: 1 })).data[0] ?? null,
    enabled,
  });

export const useResignationDetail = (id: string | undefined) =>
  useQuery({ queryKey: keys.detail(id ?? ''), queryFn: () => get<ResignationDetail>(`/offboarding/${id}`), enabled: !!id });

/** Submits my resignation (HR and my manager are notified). */
export const useSubmitResignation = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: OffboardingCreateInput) => post<ResignationDetail>('/offboarding', input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['offboarding'] }),
  });
};

/** Withdraws my resignation (only while `canCancel`). */
export const useWithdrawResignation = (id: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => post<ResignationDetail>(`/offboarding/${id}/cancel`, { note: 'Resignation withdrawn by employee' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['offboarding'] }),
  });
};
