import { useQuery } from '@tanstack/react-query';
import { get } from '@/lib/api';
import { useAuth } from '@/lib/auth';

/* Same shapes as the web `features/assets/api.ts` (`GET /assets/mine`). */

export interface AssetRef {
  _id: string;
  assetTag: string;
  name: string;
  category: string;
  serialNumber?: string;
  status: string;
  brand?: string;
  model?: string;
  condition?: string;
}

export interface MyAssetAssignment {
  _id: string;
  assetId: AssetRef | string;
  assignedDate: string;
  expectedReturnDate?: string | null;
  returnedDate?: string | null;
  conditionAtAssignment?: string;
  notes?: string;
  status: 'ACTIVE' | 'RETURNED';
  assignedBy?: { _id: string; firstName: string; lastName: string } | null;
  createdAt: string;
}

export const assetKeys = {
  all: ['assets'] as const,
  mine: ['assets', 'mine'] as const,
};

export const useMyAssets = () => {
  const { hasEmployee } = useAuth();
  return useQuery({ queryKey: assetKeys.mine, queryFn: () => get<MyAssetAssignment[]>('/assets/mine'), enabled: hasEmployee });
};
