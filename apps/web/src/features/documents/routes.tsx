import { lazy } from 'react';
import type { RouteObject } from 'react-router-dom';

const DocumentsPage = lazy(() => import('./documents-page').then((m) => ({ default: m.DocumentsPage })));

export const routes: RouteObject[] = [{ path: '/documents', element: <DocumentsPage /> }];
