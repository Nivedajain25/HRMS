import { lazy } from 'react';
import type { RouteObject } from 'react-router-dom';

const LoansPage = lazy(() => import('./loans-page').then((m) => ({ default: m.LoansPage })));

export const routes: RouteObject[] = [{ path: '/loans', element: <LoansPage /> }];
