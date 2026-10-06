import { lazy } from 'react';
import type { RouteObject } from 'react-router-dom';

const AnnouncementsPage = lazy(() => import('./announcements-page').then((m) => ({ default: m.AnnouncementsPage })));
const AnnouncementDetailPage = lazy(() => import('./announcement-detail-page').then((m) => ({ default: m.AnnouncementDetailPage })));

export const routes: RouteObject[] = [
  { path: '/announcements', element: <AnnouncementsPage /> },
  { path: '/announcements/:id', element: <AnnouncementDetailPage /> },
];
