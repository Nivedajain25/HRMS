import { lazy } from 'react';
import type { RouteObject } from 'react-router-dom';

const TasksPage = lazy(() => import('./tasks-page').then((m) => ({ default: m.TasksPage })));

export const routes: RouteObject[] = [{ path: '/tasks', element: <TasksPage /> }];
