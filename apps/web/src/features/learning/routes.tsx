import { lazy } from 'react';
import type { RouteObject } from 'react-router-dom';

const LearningPage = lazy(() => import('./learning-pages').then((m) => ({ default: m.LearningPage })));
const MyTrainingPage = lazy(() => import('./learning-pages').then((m) => ({ default: m.MyTrainingPage })));

export const routes: RouteObject[] = [
  { path: '/performance/learning', element: <LearningPage /> },
  { path: '/performance/training', element: <MyTrainingPage /> },
];
