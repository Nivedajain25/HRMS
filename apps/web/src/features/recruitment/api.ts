import { keepPreviousData, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { z } from 'zod';
import type {
  CandidateStage,
  candidateSchema,
  candidateStageSchema,
  hireCandidateSchema,
  interviewFeedbackSchema,
  interviewSchema,
  interviewStatusSchema,
  interviewUpdateSchema,
  jobOpeningSchema,
  jobOpeningUpdateSchema,
} from '@stencil/shared';
import { del, get, getPaged, patch, post, upload } from '@/lib/api';

/* --------------------------------- Types -------------------------------- */

export type { CandidateStage };
export type JobStatus = 'DRAFT' | 'OPEN' | 'ON_HOLD' | 'CLOSED';
export type InterviewStatus = 'SCHEDULED' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW';
export type Recommendation = 'STRONG_HIRE' | 'HIRE' | 'NO_HIRE' | 'STRONG_NO_HIRE';

export interface Ref {
  _id: string;
  name: string;
  code?: string;
}

export interface PersonRef {
  _id: string;
  employeeId?: string;
  firstName: string;
  lastName: string;
  profilePhoto?: string | null;
}

export interface JobOpening {
  _id: string;
  code: string;
  title: string;
  departmentId?: Ref | null;
  designationId?: Ref | null;
  locationId?: (Ref & { city?: string }) | null;
  hiringManagerId?: PersonRef | null;
  employmentType: string;
  openings: number;
  filled: number;
  experienceMin: number;
  experienceMax: number;
  salaryMin: number;
  salaryMax: number;
  currency?: string;
  skills: string[];
  description: string;
  requirements?: string;
  status: JobStatus;
  closingDate?: string | null;
  publishedAt?: string | null;
  createdAt: string;
  candidateCounts: Partial<Record<CandidateStage, number>>;
  candidateTotal: number;
}

export interface JobRef {
  _id: string;
  code: string;
  title: string;
  status?: JobStatus;
}

export interface CandidateSummary {
  _id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  stage: CandidateStage;
  source: string;
  rating?: number | null;
  experienceYears: number;
  skills: string[];
  currentCompany?: string;
  expectedSalary?: number | null;
  jobId: JobRef | null;
  /** Employee who referred them (source REFERRAL). */
  referredBy?: PersonRef | null;
  createdAt: string;
  updatedAt: string;
}

/** Dashboard "Referrals" card. */
export interface ReferralSummary {
  total: number;
  inProcess: number;
  hired: number;
  recent: (Pick<CandidateSummary, '_id' | 'firstName' | 'lastName' | 'stage' | 'createdAt'> & { jobId: JobRef | null; referredBy: PersonRef | null })[];
  topReferrer: (PersonRef & { count: number }) | null;
}

export interface StageHistoryEntry {
  from: CandidateStage | null;
  to: CandidateStage;
  note?: string;
  by?: { _id: string; firstName: string; lastName: string } | null;
  at: string;
}

export interface InterviewFeedback {
  interviewerId: string;
  interviewerName?: string;
  rating?: number;
  feedback?: string;
  recommendation?: Recommendation;
  at: string;
}

export interface Interview {
  _id: string;
  candidateId: string | { _id: string; firstName: string; lastName: string; email: string; phone?: string; stage: CandidateStage } | null;
  jobId: string | JobRef | null;
  interviewerIds: PersonRef[];
  scheduledAt: string;
  durationMinutes: number;
  type: string;
  round: number;
  meetingLink?: string;
  location?: string;
  notes?: string;
  status: InterviewStatus;
  cancellationReason?: string;
  feedback: InterviewFeedback[];
  rating?: number | null;
  rescheduleCount?: number;
  createdAt: string;
}

export interface CandidateDetail extends Omit<CandidateSummary, 'jobId'> {
  jobId: (JobRef & { departmentId?: string | null }) | null;
  resumeFileId?: string | null;
  currentSalary?: number | null;
  noticePeriodDays?: number | null;
  notes?: string;
  rejectionReason?: string;
  hiredEmployeeId?: PersonRef | null;
  hiredAt?: string | null;
  hiringStartedAt?: string | null;
  stageHistory: StageHistoryEntry[];
  interviews: Interview[];
}

export type PipelineCandidate = Pick<
  CandidateSummary,
  '_id' | 'firstName' | 'lastName' | 'email' | 'phone' | 'stage' | 'source' | 'rating' | 'experienceYears' | 'skills' | 'jobId' | 'createdAt' | 'updatedAt'
>;

export interface Pipeline {
  job: { _id: string; code: string; title: string; status: JobStatus; openings: number; filled: number } | null;
  stages: { stage: CandidateStage; count: number; candidates: PipelineCandidate[] }[];
}

export interface RecruitmentSummary {
  openJobs: number;
  openPositions: number;
  jobsByStatus: Partial<Record<JobStatus, number>>;
  candidatesByStage: Record<CandidateStage, number>;
  totalCandidates: number;
  sourceBreakdown: { source: string; count: number }[];
  interviewsThisWeek: number;
  hires: number;
  timeToHireAvgDays: number | null;
}

export interface HirePrefill {
  candidateId: string;
  stage: CandidateStage;
  canHire: boolean;
  firstName: string;
  lastName: string;
  personalEmail: string;
  phone: string | null;
  departmentId: string | null;
  designationId: string | null;
  locationId: string | null;
  managerId: string | null;
  employmentType: string;
  joiningDate: string;
  job: { _id: string; code: string; title: string };
}

export interface HireResult {
  employee: { _id: string; employeeId: string; firstName: string; lastName: string };
  onboardingId: string | null;
  candidateId: string;
  job: { _id: string; filled: number; openings: number; status: JobStatus } | null;
}

export interface OnboardingTemplate {
  _id: string;
  name: string;
  isDefault?: boolean;
}

export type JobInput = z.output<typeof jobOpeningSchema>;
export type JobUpdateInput = z.output<typeof jobOpeningUpdateSchema>;
export type CandidateInput = z.output<typeof candidateSchema>;
export type StageInput = z.output<typeof candidateStageSchema>;
export type InterviewInput = z.output<typeof interviewSchema>;
export type InterviewUpdateInput = z.output<typeof interviewUpdateSchema>;
export type InterviewStatusInput = z.output<typeof interviewStatusSchema>;
export type FeedbackInput = z.output<typeof interviewFeedbackSchema>;
export type HireInput = z.output<typeof hireCandidateSchema>;

/* ------------------------------ Query keys ------------------------------ */

export const recruitmentKeys = {
  all: ['recruitment'] as const,
  jobs: (q: object) => ['recruitment', 'jobs', q] as const,
  job: (id: string) => ['recruitment', 'job', id] as const,
  pipeline: (jobId?: string) => ['recruitment', 'pipeline', jobId ?? 'all'] as const,
  candidates: (q: object) => ['recruitment', 'candidates', q] as const,
  candidate: (id: string) => ['recruitment', 'candidate', id] as const,
  interviews: (q: object) => ['recruitment', 'interviews', q] as const,
  interview: (id: string) => ['recruitment', 'interview', id] as const,
  summary: ['recruitment', 'summary'] as const,
  referrals: ['recruitment', 'referrals'] as const,
  prefill: (id: string) => ['recruitment', 'hire-prefill', id] as const,
};

const invalidateAll = (qc: QueryClient) => qc.invalidateQueries({ queryKey: recruitmentKeys.all });

/* --------------------------------- Jobs --------------------------------- */

export const useJobs = (query: object, enabled = true) =>
  useQuery({
    queryKey: recruitmentKeys.jobs(query),
    queryFn: () => getPaged<JobOpening>('/recruitment/jobs', query),
    placeholderData: keepPreviousData,
    enabled,
  });

/** Up to 100 jobs for pickers/filters (most recent first). */
export const useJobOptions = (status?: JobStatus) =>
  useQuery({
    queryKey: recruitmentKeys.jobs({ options: true, status }),
    queryFn: () => getPaged<JobOpening>('/recruitment/jobs', { limit: 100, status, sortBy: 'createdAt', sortOrder: 'desc' }),
    staleTime: 60_000,
    select: (res) => res.data,
  });

export const useJob = (id: string | undefined) =>
  useQuery({ queryKey: recruitmentKeys.job(id ?? ''), queryFn: () => get<JobOpening>(`/recruitment/jobs/${id}`), enabled: !!id });

export const useSaveJob = (id?: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: JobInput | JobUpdateInput) => (id ? patch<JobOpening>(`/recruitment/jobs/${id}`, input) : post<JobOpening>('/recruitment/jobs', input)),
    meta: { silent: true },
    onSuccess: () => invalidateAll(qc),
  });
};

export const useJobStatus = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: JobStatus }) => post<JobOpening>(`/recruitment/jobs/${id}/status`, { status }),
    onSuccess: () => invalidateAll(qc),
  });
};

export const useDeleteJob = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => del<{ deleted: boolean; closed: boolean }>(`/recruitment/jobs/${id}`),
    onSuccess: () => invalidateAll(qc),
  });
};

export const useRecruitmentSummary = (enabled: boolean) =>
  useQuery({ queryKey: recruitmentKeys.summary, queryFn: () => get<RecruitmentSummary>('/recruitment/summary'), enabled });

export const useReferralSummary = (enabled: boolean) =>
  useQuery({ queryKey: recruitmentKeys.referrals, queryFn: () => get<ReferralSummary>('/recruitment/referrals/summary'), enabled });

/* ------------------------------- Pipeline ------------------------------- */

export const usePipeline = (jobId: string | undefined) =>
  useQuery({ queryKey: recruitmentKeys.pipeline(jobId), queryFn: () => get<Pipeline>('/recruitment/pipeline', { jobId }), enabled: !!jobId });

/* ------------------------------ Candidates ------------------------------ */

export const useCandidates = (query: object) =>
  useQuery({
    queryKey: recruitmentKeys.candidates(query),
    queryFn: () => getPaged<CandidateSummary>('/recruitment/candidates', query),
    placeholderData: keepPreviousData,
  });

export const useCandidate = (id: string | undefined) =>
  useQuery({ queryKey: recruitmentKeys.candidate(id ?? ''), queryFn: () => get<CandidateDetail>(`/recruitment/candidates/${id}`), enabled: !!id });

export const useSaveCandidate = (id?: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CandidateInput | Omit<CandidateInput, 'jobId'>) =>
      id ? patch<CandidateDetail>(`/recruitment/candidates/${id}`, input) : post<CandidateDetail>('/recruitment/candidates', input),
    meta: { silent: true },
    onSuccess: () => invalidateAll(qc),
  });
};

export const uploadResume = async (file: File) => (await upload<{ _id: string }>('/files', file, { context: 'RESUME' })).data._id;

/**
 * Moves a candidate between stages. Kanban boards update optimistically and
 * roll back when the API rejects the transition.
 */
export const useMoveStage = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: StageInput & { id: string }) => post<CandidateDetail>(`/recruitment/candidates/${id}/stage`, input),
    onMutate: async ({ id, stage }) => {
      const key = ['recruitment', 'pipeline'];
      await qc.cancelQueries({ queryKey: key });
      const snapshot = qc.getQueriesData<Pipeline>({ queryKey: key });
      qc.setQueriesData<Pipeline>({ queryKey: key }, (old) => {
        if (!old) return old;
        const moving = old.stages.flatMap((s) => s.candidates).find((c) => c._id === id);
        if (!moving) return old;
        return {
          ...old,
          stages: old.stages.map((s) => {
            let candidates = s.candidates.filter((c) => c._id !== id);
            if (s.stage === stage) candidates = [{ ...moving, stage }, ...candidates];
            return { ...s, candidates, count: candidates.length };
          }),
        };
      });
      return { snapshot };
    },
    onError: (_err, _vars, context) => {
      for (const [key, data] of context?.snapshot ?? []) qc.setQueryData(key, data);
    },
    onSettled: () => invalidateAll(qc),
  });
};

export const useHirePrefill = (id: string, enabled: boolean) =>
  useQuery({ queryKey: recruitmentKeys.prefill(id), queryFn: () => get<HirePrefill>(`/recruitment/candidates/${id}/hire-prefill`), enabled, staleTime: 0 });

export const useHire = (id: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: HireInput) => post<HireResult>(`/recruitment/candidates/${id}/hire`, input),
    meta: { silent: true },
    onSuccess: () => {
      invalidateAll(qc);
      qc.invalidateQueries({ queryKey: ['employees'] });
      qc.invalidateQueries({ queryKey: ['onboarding'] });
    },
  });
};

export const useOnboardingTemplates = (enabled: boolean) =>
  useQuery({ queryKey: ['onboarding', 'templates', 'all'], queryFn: () => get<OnboardingTemplate[]>('/onboarding/templates/all'), enabled, staleTime: 5 * 60_000 });

/* ------------------------------ Interviews ------------------------------ */

export const useInterviews = (query: object, enabled = true) =>
  useQuery({
    queryKey: recruitmentKeys.interviews(query),
    queryFn: () => getPaged<Interview>('/recruitment/interviews', query),
    placeholderData: keepPreviousData,
    enabled,
  });

export const useInterview = (id: string | undefined) =>
  useQuery({ queryKey: recruitmentKeys.interview(id ?? ''), queryFn: () => get<Interview>(`/recruitment/interviews/${id}`), enabled: !!id });

export const useSaveInterview = (id?: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: InterviewInput | InterviewUpdateInput) =>
      id ? patch<Interview>(`/recruitment/interviews/${id}`, input) : post<Interview>('/recruitment/interviews', input),
    meta: { silent: true },
    onSuccess: () => invalidateAll(qc),
  });
};

export const useInterviewStatus = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: InterviewStatusInput & { id: string }) => post<Interview>(`/recruitment/interviews/${id}/status`, input),
    onSuccess: () => invalidateAll(qc),
  });
};

export const useInterviewFeedback = (id: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: FeedbackInput) => post<Interview>(`/recruitment/interviews/${id}/feedback`, input),
    meta: { silent: true },
    onSuccess: () => invalidateAll(qc),
  });
};
