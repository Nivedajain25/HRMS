import { lazy } from 'react';
import type { RouteObject } from 'react-router-dom';

const TravelClaimsPage = lazy(() => import('./travel-claims-page').then((m) => ({ default: m.TravelClaimsPage })));

export const routes: RouteObject[] = [{ path: '/travel-claims', element: <TravelClaimsPage /> }];
