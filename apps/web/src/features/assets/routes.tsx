import { lazy } from 'react';
import type { RouteObject } from 'react-router-dom';
import { RequirePermission } from '@/routes/guards';

const AssetListPage = lazy(() => import('./asset-list-page').then((m) => ({ default: m.AssetListPage })));
const AssetDetailPage = lazy(() => import('./asset-detail-page').then((m) => ({ default: m.AssetDetailPage })));
const AssetAssignmentsPage = lazy(() => import('./asset-assignments-page').then((m) => ({ default: m.AssetAssignmentsPage })));

export const routes: RouteObject[] = [
  { path: '/assets', element: <AssetListPage /> },
  {
    path: '/assets/assignments',
    element: (
      <RequirePermission any={['asset:read']}>
        <AssetAssignmentsPage />
      </RequirePermission>
    ),
  },
  { path: '/assets/:id', element: <AssetDetailPage /> },
];
