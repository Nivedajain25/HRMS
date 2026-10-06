import { lazy } from 'react';
import type { RouteObject } from 'react-router-dom';

const HelpPage = lazy(() => import('./help-page').then((m) => ({ default: m.HelpPage })));

export const routes: RouteObject[] = [{ path: '/help', element: <HelpPage /> }];
