import Constants, { ExecutionEnvironment } from 'expo-constants';

/** Running inside the Expo Go app (dev testing), where some native features (push, splash options) are unavailable. */
export const IN_EXPO_GO = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

interface Extra {
  apiUrl?: string;
  eas?: { projectId?: string };
}

const extra = (Constants.expoConfig?.extra ?? {}) as Extra;

/** Origin of the Stencil deployment, e.g. `https://hr.example.com` (no trailing slash). */
export const API_ORIGIN = (process.env.EXPO_PUBLIC_API_URL || extra.apiUrl || '').replace(/\/+$/, '');

/** Base URL of the REST API. */
export const API_BASE = `${API_ORIGIN}/api/v1`;

/** EAS project id (needed for Expo push tokens). */
export const EAS_PROJECT_ID: string | undefined = extra.eas?.projectId ?? Constants.easConfig?.projectId ?? undefined;

export const APP_VERSION = Constants.expoConfig?.version ?? '1.0.0';

/** Absolute URL for an API-relative path such as `/api/v1/files/<id>`. */
export const absoluteUrl = (path: string) => (/^https?:\/\//i.test(path) ? path : `${API_ORIGIN}${path.startsWith('/') ? '' : '/'}${path}`);

/** Web app URL (for flows that stay on the web, e.g. password reset). */
export const webUrl = (path: string) => `${API_ORIGIN}${path}`;
