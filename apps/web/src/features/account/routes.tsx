import { lazy } from 'react';
import type { RouteObject } from 'react-router-dom';

const MyAccountPage = lazy(() => import('./my-account-page').then((m) => ({ default: m.MyAccountPage })));

export const routes: RouteObject[] = [{ path: '/account', element: <MyAccountPage /> }];
