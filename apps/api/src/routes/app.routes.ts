import type { Request, Response } from 'express';
import { latestAppRelease } from '../services/app-update.service';
import { ok } from '../utils/response';
import { createModule } from './registry';

/** The mobile app itself: in-app updates. */
export const appModule = createModule('App', '/api/v1/app');

appModule.route(
  {
    method: 'get',
    path: '/latest',
    summary: 'Latest Android app release',
    description:
      'The newest APK published on GitHub Releases (tag `android-v<build>`): `build` (Android version code), `version`, `notes`, `url` (public download link), `size` (bytes) and `publishedAt`; `null` when there is none. The app offers to download and install it when its own build is older. Public; cached for 5 minutes.',
    public: true,
  },
  async (_req: Request, res: Response) => {
    ok(res, await latestAppRelease());
  },
);
