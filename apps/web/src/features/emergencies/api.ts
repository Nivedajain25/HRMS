import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ambulance, Baby, CircleAlert, House, Thermometer, Users, type LucideIcon } from 'lucide-react';
import type { EmergencyCategory, EmergencyRaiseInput, EmergencyStatus } from '@stencil/shared';
import { get, getPaged, patch, post } from '@/lib/api';

export type { EmergencyCategory, EmergencyStatus };

interface PersonRef {
  _id: string;
  firstName: string;
  lastName: string;
}

export interface Emergency {
  _id: string;
  employeeId: PersonRef & {
    employeeId: string;
    profilePhoto?: string | null;
    phone?: string;
    workEmail?: string;
    departmentId?: { _id: string; name: string } | null;
    designationId?: { _id: string; name: string } | null;
  };
  category: EmergencyCategory;
  message?: string;
  /** They have to leave work right away. */
  needToLeave: boolean;
  contactPhone?: string;
  location: { latitude: number; longitude: number; accuracy?: number } | null;
  status: EmergencyStatus;
  acknowledgedBy?: PersonRef | null;
  acknowledgedAt?: string | null;
  resolvedBy?: PersonRef | null;
  resolvedAt?: string | null;
  /** HR's answer to the request to leave (null until decided). */
  decision?: 'APPROVED' | 'DECLINED' | null;
  decidedBy?: PersonRef | null;
  decidedAt?: string | null;
  notes: { byName?: string; text: string; at: string }[];
  createdAt: string;
}

/** `label`: short (picker chips); `title`: full phrase (alerts, lists); `icon`: the category's line icon. */
export const CATEGORY_META: Record<EmergencyCategory, { label: string; title: string; icon: LucideIcon }> = {
  FAMILY: { label: 'Family', title: 'Family emergency', icon: Users },
  HEALTH: { label: 'Unwell', title: 'Feeling unwell', icon: Thermometer },
  HOME: { label: 'At home', title: 'Emergency at home', icon: House },
  CHILD: { label: 'Child / school', title: 'Child / school emergency', icon: Baby },
  ACCIDENT: { label: 'Accident', title: 'Accident', icon: Ambulance },
  OTHER: { label: 'Other', title: 'Personal emergency', icon: CircleAlert },
};

export const emergencyKeys = {
  all: ['emergencies'] as const,
  active: ['emergencies', 'active'] as const,
  list: (q: object) => ['emergencies', 'list', q] as const,
  detail: (id: string) => ['emergencies', 'detail', id] as const,
};

/** HR's live feed of unresolved alerts: polled often so a new one surfaces within seconds. */
export const useActiveEmergencies = (enabled: boolean) =>
  useQuery({
    queryKey: emergencyKeys.active,
    queryFn: () => get<Emergency[]>('/emergencies/active'),
    enabled,
    refetchInterval: 10_000,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
  });

export const useEmergencies = (query: object) =>
  useQuery({ queryKey: emergencyKeys.list(query), queryFn: () => getPaged<Emergency>('/emergencies', query), placeholderData: keepPreviousData });

export const useEmergency = (id: string | undefined) =>
  useQuery({ queryKey: emergencyKeys.detail(id ?? ''), queryFn: () => get<Emergency>(`/emergencies/${id}`), enabled: !!id, refetchInterval: 15_000 });

export const useRaiseEmergency = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: EmergencyRaiseInput) => post<Emergency>('/emergencies', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: emergencyKeys.all }),
  });
};

/** The signed-in employee's latest emergency (polled so HR's answer shows up within seconds). */
export const useMyLatestEmergency = (enabled: boolean) =>
  useQuery({
    queryKey: ['emergencies', 'mine', 'latest'],
    queryFn: async () => (await getPaged<Emergency>('/emergencies', { scope: 'mine', page: 1, limit: 1 })).data[0] ?? null,
    enabled,
    refetchInterval: 10_000,
    refetchIntervalInBackground: true,
  });

/** Approve (they may leave) or decline the request; closes the alert and tells the employee at once. */
export const useDecideEmergency = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: { id: string; decision: 'APPROVED' | 'DECLINED'; note?: string }) => post<Emergency>(`/emergencies/${id}/decision`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: emergencyKeys.all }),
  });
};

export const useUpdateEmergency = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: { id: string; status: 'ACKNOWLEDGED' | 'RESOLVED'; note?: string }) => patch<Emergency>(`/emergencies/${id}`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: emergencyKeys.all }),
  });
};
