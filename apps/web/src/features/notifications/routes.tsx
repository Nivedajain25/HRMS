import { lazy } from 'react';
import type { RouteObject } from 'react-router-dom';

const NotificationsPage = lazy(() => import('./notifications-page').then((m) => ({ default: m.NotificationsPage })));

export const routes: RouteObject[] = [{ path: '/notifications', element: <NotificationsPage /> }];
