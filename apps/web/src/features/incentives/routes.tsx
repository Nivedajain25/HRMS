import { lazy } from 'react';
import type { RouteObject } from 'react-router-dom';

const IncentivesPage = lazy(() => import('./incentives-page').then((m) => ({ default: m.IncentivesPage })));

export const routes: RouteObject[] = [{ path: '/incentives', element: <IncentivesPage /> }];
