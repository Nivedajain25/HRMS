import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ambulance, CircleAlert, HeartPulse, House, School, Users, type LucideIcon } from 'lucide-react-native';
import { get, getPaged, patch, post } from '@/lib/api';

/* Same shapes as the web `features/emergencies/api.ts`. */

export type EmergencyCategory = 'FAMILY' | 'HEALTH' | 'HOME' | 'CHILD' | 'ACCIDENT' | 'OTHER';
export type EmergencyStatus = 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED';
export type EmergencyDecision = 'APPROVED' | 'DECLINED';

export const CATEGORY_META: Record<EmergencyCategory, { label: string; icon: LucideIcon }> = {
  FAMILY: { label: 'Family', icon: Users },
  HEALTH: { label: 'Unwell', icon: HeartPulse },
  HOME: { label: 'At home', icon: House },
  CHILD: { label: 'Child / school', icon: School },
  ACCIDENT: { label: 'Accident', icon: Ambulance },
  OTHER: { label: 'Other', icon: CircleAlert },
};

export interface Emergency {
  _id: string;
  category: EmergencyCategory;
  message?: string;
  needToLeave: boolean;
  contactPhone?: string;
  status: EmergencyStatus;
  location?: { latitude: number; longitude: number; accuracy?: number } | null;
  employeeId?: {
    _id: string;
    employeeId: string;
    firstName: string;
    lastName: string;
    profilePhoto?: string | null;
    phone?: string;
    departmentId?: { name: string } | null;
    designationId?: { name: string } | null;
  } | null;
  acknowledgedBy?: { firstName: string; lastName: string } | null;
  acknowledgedAt?: string | null;
  resolvedBy?: { firstName: string; lastName: string } | null;
  resolvedAt?: string | null;
  /** HR's answer to the request to leave (null until decided). */
  decision?: EmergencyDecision | null;
  decidedBy?: { firstName: string; lastName: string } | null;
  decidedAt?: string | null;
  notes?: { byName?: string; text: string; at: string }[];
  createdAt: string;
}

export const emergencyKeys = {
  all: ['emergencies'] as const,
  active: ['emergencies', 'active'] as const,
  list: (state: 'active' | 'resolved') => ['emergencies', 'list', state] as const,
};

/** Informs HR and the reporting manager at once (in-app, email and push). */
export const useRaiseEmergency = () =>
  useMutation({
    mutationFn: (input: { category: EmergencyCategory; needToLeave: boolean; message?: string; contactPhone?: string }) =>
      post<Emergency>('/emergencies', input),
  });

/** Unresolved alerts (HR banner) — checked every 10 s so nobody misses one. */
export const useActiveEmergencies = (enabled: boolean) =>
  useQuery({ queryKey: emergencyKeys.active, queryFn: () => get<Emergency[]>('/emergencies/active'), enabled, refetchInterval: 10_000 });

/** Resolved alerts (history), newest first. */
export const useResolvedEmergencies = (enabled: boolean) =>
  useQuery({
    queryKey: emergencyKeys.list('resolved'),
    queryFn: async () => (await getPaged<Emergency>('/emergencies', { scope: 'all', status: 'RESOLVED', limit: 50 })).data,
    enabled,
  });

/** The signed-in employee's latest emergency (polled so HR's answer shows up within seconds). */
export const useMyLatestEmergency = (enabled: boolean) =>
  useQuery({
    queryKey: ['emergencies', 'mine', 'latest'],
    queryFn: async () => (await getPaged<Emergency>('/emergencies', { scope: 'mine', page: 1, limit: 1 })).data[0] ?? null,
    enabled,
    refetchInterval: 10_000,
  });

/** HR / super admin: approve or decline the request to leave (closes the alert; the employee is told at once). */
export const useDecideEmergency = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; decision: EmergencyDecision; note?: string }) =>
      post<Emergency>(`/emergencies/${v.id}/decision`, { decision: v.decision, note: v.note }),
    onSuccess: () => qc.invalidateQueries({ queryKey: emergencyKeys.all }),
  });
};

/** HR: acknowledge (someone is on it) or resolve, with an optional note. The employee is told. */
export const useUpdateEmergency = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; status: 'ACKNOWLEDGED' | 'RESOLVED'; note?: string }) => patch<Emergency>(`/emergencies/${v.id}`, { status: v.status, note: v.note }),
    onSuccess: () => qc.invalidateQueries({ queryKey: emergencyKeys.all }),
  });
};
