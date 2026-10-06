import { Platform } from 'react-native';
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import type { ApiError as ApiErrorBody, ApiFieldError, ApiPaginated, ApiSuccess, MobileAuthSession, Pagination } from '@stencil/types';
import { MOBILE_CLIENT_VALUE } from '@stencil/shared';
import { API_BASE, API_ORIGIN } from './config';
import { storage, StorageKeys } from './storage';

/* --------------------------------- Errors -------------------------------- */

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
    public readonly fieldErrors: ApiFieldError[] = [],
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const toApiError = (err: unknown): ApiError => {
  if (err instanceof ApiError) return err;
  return new ApiError(err instanceof Error ? err.message : 'Something went wrong. Please try again.', 0, 'ERROR');
};

const notConfigured = () =>
  new ApiError(
    'This app is not configured with a server address. Reinstall the latest build from your administrator.',
    0,
    'NOT_CONFIGURED',
  );

/* ------------------------------ Session state ---------------------------- */

/** Access token lives in memory only; the refresh token is in SecureStore. */
let accessToken: string | null = null;
export const getAccessToken = () => accessToken;
export const setAccessToken = (token: string | null) => {
  accessToken = token;
};

interface SessionHandlers {
  /** A refresh produced a new session (new user snapshot + access token). */
  onRefreshed: (session: MobileAuthSession) => void;
  /** The session can no longer be refreshed — sign the user out. */
  onExpired: () => void;
}
let handlers: SessionHandlers | null = null;
export const setSessionHandlers = (next: SessionHandlers | null) => {
  handlers = next;
};

const CLIENT_HEADERS: Record<string, string> = {
  Accept: 'application/json',
  'X-Client': MOBILE_CLIENT_VALUE,
  // Required by the cookie-CSRF guard on /auth/refresh and /auth/logout.
  'X-Requested-With': 'XMLHttpRequest',
};

/** Headers for authenticated requests made outside `request` (images, downloads). */
export const authHeaders = (): Record<string, string> => ({
  'X-Client': MOBILE_CLIENT_VALUE,
  ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
});

/* --------------------------------- Fetch --------------------------------- */

const DEFAULT_TIMEOUT = 30_000;
const UPLOAD_TIMEOUT = 120_000;

export type QueryParams = Record<string, string | number | boolean | null | undefined>;

/** Absolute URL: `/attendance` → `<origin>/api/v1/attendance`; `/api/v1/files/x` → `<origin>/api/v1/files/x`. */
export const apiUrl = (path: string, query?: QueryParams) => {
  const base = /^https?:\/\//i.test(path) ? path : path.startsWith('/api/') ? `${API_ORIGIN}${path}` : `${API_BASE}${path}`;
  const qs = Object.entries(query ?? {})
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
  return qs ? `${base}${base.includes('?') ? '&' : '?'}${qs}` : base;
};

const rawFetch = async (url: string, init: RequestInit, timeoutMs: number): Promise<Response> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch {
    if (controller.signal.aborted) throw new ApiError('The server took too long to respond. Please try again.', 0, 'TIMEOUT');
    throw new ApiError('Cannot reach the server. Check your internet connection and try again.', 0, 'NETWORK_ERROR');
  } finally {
    clearTimeout(timer);
  }
};

/** Parsed JSON body; `null` for an empty body, `undefined` for a non-JSON body (e.g. a proxy error page). */
const parseBody = async (res: Response): Promise<unknown> => {
  let text: string;
  try {
    text = await res.text();
  } catch {
    return undefined;
  }
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
};

const isErrorBody = (body: unknown): body is Partial<ApiErrorBody> & { message: string } =>
  !!body && typeof body === 'object' && typeof (body as { message?: unknown }).message === 'string';

const errorFrom = (res: Response, body: unknown): ApiError => {
  if (isErrorBody(body)) {
    return new ApiError(body.message, res.status, body.code ?? 'ERROR', Array.isArray(body.errors) ? body.errors : []);
  }
  if (res.status === 502 || res.status === 503 || res.status === 504) {
    return new ApiError(
      'The server is starting up or temporarily unavailable. Please try again in a moment.',
      res.status,
      'SERVER_UNAVAILABLE',
    );
  }
  if (res.status === 429) return new ApiError('Too many requests. Please wait a moment and try again.', 429, 'RATE_LIMITED');
  if (res.status === 404) return new ApiError('The server could not find this resource.', 404, 'NOT_FOUND');
  return new ApiError(`The server returned an unexpected error (${res.status}).`, res.status, 'ERROR');
};

/* -------------------------------- Refresh -------------------------------- */

let refreshing: Promise<MobileAuthSession | null> | null = null;

/**
 * Single-flight session refresh: concurrent 401s share one `POST /auth/refresh`.
 * Resolves `null` when the stored refresh token is missing, expired or revoked;
 * rejects with an `ApiError` on network/server failures (the session may still be valid).
 */
export const refreshSession = (): Promise<MobileAuthSession | null> => {
  refreshing ??= (async () => {
    if (!API_ORIGIN) throw notConfigured();
    const refreshToken = await storage.get(StorageKeys.refreshToken);
    if (!refreshToken) return null;
    const res = await rawFetch(
      `${API_BASE}/auth/refresh`,
      { method: 'POST', headers: { ...CLIENT_HEADERS, 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken }) },
      DEFAULT_TIMEOUT,
    );
    const body = await parseBody(res);
    if (!res.ok) {
      if (res.status === 400 || res.status === 401 || res.status === 403) return null;
      throw errorFrom(res, body);
    }
    const session = (body as ApiSuccess<MobileAuthSession> | null)?.data;
    if (!session?.accessToken) throw new ApiError('Unexpected response from the server.', res.status, 'BAD_RESPONSE');
    accessToken = session.accessToken;
    // `null` = the token was rotated moments ago by a concurrent request: keep the stored one.
    if (session.refreshToken) await storage.set(StorageKeys.refreshToken, session.refreshToken);
    handlers?.onRefreshed(session);
    return session;
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
};

/* -------------------------------- Request -------------------------------- */

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export interface RequestOptions {
  method?: Method;
  query?: QueryParams;
  /** JSON body. */
  body?: unknown;
  /** Multipart body (takes precedence over `body`). */
  form?: FormData;
  /** Send the bearer token and refresh on 401 (default true). */
  auth?: boolean;
  timeoutMs?: number;
}

export const request = async <T>(path: string, opts: RequestOptions = {}): Promise<T> => {
  if (!API_ORIGIN) throw notConfigured();
  const auth = opts.auth ?? true;
  const url = apiUrl(path, opts.query);

  const send = () => {
    const headers: Record<string, string> = { ...CLIENT_HEADERS };
    if (auth && accessToken) headers.Authorization = `Bearer ${accessToken}`;
    let body: RequestInit['body'];
    if (opts.form) {
      body = opts.form;
    } else if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(opts.body);
    }
    return rawFetch(url, { method: opts.method ?? 'GET', headers, body }, opts.timeoutMs ?? (opts.form ? UPLOAD_TIMEOUT : DEFAULT_TIMEOUT));
  };

  let res = await send();
  if (res.status === 401 && auth) {
    const session = await refreshSession();
    if (session) {
      res = await send();
      if (res.status === 401) handlers?.onExpired();
    } else {
      handlers?.onExpired();
    }
  }
  const body = await parseBody(res);
  if (!res.ok) throw errorFrom(res, body);
  if (body === undefined) throw new ApiError('Unexpected response from the server.', res.status, 'BAD_RESPONSE');
  return body as T;
};

/* -------------------------------- Helpers -------------------------------- */

export interface Paged<T> {
  data: T[];
  pagination: Pagination;
}

export interface Mutation<T> {
  data: T;
  message?: string;
}

export const get = async <T>(path: string, query?: QueryParams) => (await request<ApiSuccess<T>>(path, { query })).data;

export const getPaged = async <T>(path: string, query?: QueryParams): Promise<Paged<T>> => {
  const res = await request<ApiPaginated<T>>(path, { query });
  return { data: res.data, pagination: res.pagination };
};

const mutate = async <T>(method: Method, path: string, body?: unknown): Promise<Mutation<T>> => {
  const res = await request<ApiSuccess<T> | null>(path, { method, body });
  return { data: (res?.data ?? null) as T, message: res?.message };
};

export const post = <T>(path: string, body?: unknown) => mutate<T>('POST', path, body ?? {});
export const patch = <T>(path: string, body?: unknown) => mutate<T>('PATCH', path, body ?? {});
export const put = <T>(path: string, body?: unknown) => mutate<T>('PUT', path, body ?? {});
export const del = <T>(path: string) => mutate<T>('DELETE', path);

/** A local file to upload (camera/picker result). */
export interface UploadFile {
  uri: string;
  name: string;
  /** MIME type, e.g. `image/jpeg`. */
  type: string;
}

/** Multipart upload (`file` + extra fields), e.g. `POST /files` with `context`. */
export const upload = async <T>(path: string, file: UploadFile, fields: Record<string, string | undefined> = {}): Promise<Mutation<T>> => {
  const form = new FormData();
  if (Platform.OS === 'web') {
    // Browsers need a real Blob (the camera/picker gives a blob: or data: URL).
    const blob = await (await fetch(file.uri)).blob();
    // `File` here is expo-file-system's, so use the browser's global one.
    form.append('file', new globalThis.File([blob], file.name, { type: blob.type || file.type }));
  } else {
    // React Native's FormData accepts `{ uri, name, type }` file descriptors.
    form.append('file', { uri: file.uri, name: file.name, type: file.type } as unknown as Blob);
  }
  for (const [k, v] of Object.entries(fields)) if (v !== undefined && v !== '') form.append(k, v);
  const res = await request<ApiSuccess<T>>(path, { method: 'POST', form });
  return { data: res.data, message: res.message };
};

/* ------------------------------- Downloads ------------------------------- */

const safeFileName = (name: string) =>
  Array.from(name, (ch) => (ch.charCodeAt(0) < 32 || '\\/:*?"<>|'.includes(ch) ? '_' : ch))
    .join('')
    .slice(0, 120) || 'download';

/**
 * Downloads an authenticated file (payslip PDF, document…) into the cache
 * directory and returns it. Retries once after refreshing an expired session.
 */
export const downloadFile = async (path: string, opts: { fileName?: string; query?: QueryParams } = {}): Promise<File> => {
  if (!API_ORIGIN) throw notConfigured();
  const dir = new Directory(Paths.cache, 'downloads');
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  const url = apiUrl(path, opts.query);
  const target = opts.fileName ? new File(dir, safeFileName(opts.fileName)) : dir;
  const attempt = () => File.downloadFileAsync(url, target, { headers: authHeaders(), idempotent: true });
  try {
    return await attempt();
  } catch {
    const session = await refreshSession().catch(() => null);
    if (session) {
      try {
        return await attempt();
      } catch {
        /* fall through */
      }
    }
    throw new ApiError('Could not download the file. Check your connection and try again.', 0, 'DOWNLOAD_FAILED');
  }
};

/** Downloads an authenticated file and opens the system share / open-with sheet. */
export const shareDownload = async (
  path: string,
  opts: { fileName?: string; query?: QueryParams; mimeType?: string; dialogTitle?: string } = {},
): Promise<File> => {
  const file = await downloadFile(path, opts);
  if (!(await Sharing.isAvailableAsync())) throw new ApiError('Sharing is not available on this device.', 0, 'SHARE_UNAVAILABLE');
  await Sharing.shareAsync(file.uri, { mimeType: opts.mimeType, dialogTitle: opts.dialogTitle });
  return file;
};
