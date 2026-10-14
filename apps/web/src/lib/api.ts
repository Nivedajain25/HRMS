import axios, { type AxiosError, type AxiosRequestConfig, type InternalAxiosRequestConfig } from 'axios';
import type { ApiError as ApiErrorBody, ApiFieldError, AuthSession, Pagination } from '@stencil/types';
import { useAuthStore } from '@/store/auth';

export const API_BASE = '/api/v1';

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
    public readonly fieldErrors: ApiFieldError[] = [],
  ) {
    super(message);
  }
}

export const api = axios.create({
  baseURL: API_BASE,
  withCredentials: true,
  headers: { 'X-Requested-With': 'XMLHttpRequest' },
  timeout: 60_000,
});

api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

let refreshing: Promise<AuthSession | null> | null = null;

/** Single-flight refresh: concurrent 401s share one refresh request. */
export const refreshSession = () => {
  refreshing ??= axios
    .post<{ data: AuthSession }>(`${API_BASE}/auth/refresh`, null, {
      withCredentials: true,
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    })
    .then((res) => {
      useAuthStore.getState().setSession(res.data.data.user, res.data.data.accessToken);
      return res.data.data;
    })
    .catch(() => null)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
};

api.interceptors.response.use(
  (res) => res,
  async (error: AxiosError<ApiErrorBody>) => {
    const original = error.config as (InternalAxiosRequestConfig & { _retried?: boolean }) | undefined;
    const status = error.response?.status;
    const isAuthRoute = original?.url?.startsWith('/auth/') && !original.url.startsWith('/auth/me');
    if (status === 401 && original && !original._retried && !isAuthRoute) {
      original._retried = true;
      const session = await refreshSession();
      if (session) {
        original.headers.Authorization = `Bearer ${session.accessToken}`;
        return api(original);
      }
      useAuthStore.getState().clear();
    }
    throw toApiError(error);
  },
);

export const toApiError = (error: unknown): ApiError => {
  if (error instanceof ApiError) return error;
  if (axios.isAxiosError(error)) {
    const body = error.response?.data as Partial<ApiErrorBody> | Blob | undefined;
    if (body && !(body instanceof Blob) && body.message) {
      return new ApiError(body.message, error.response?.status ?? 0, body.code ?? 'ERROR', body.errors ?? []);
    }
    if (!error.response) return new ApiError('Cannot reach the server. Check your connection.', 0, 'NETWORK_ERROR');
    return new ApiError(error.message, error.response.status, 'ERROR');
  }
  return new ApiError(error instanceof Error ? error.message : 'Unexpected error', 0, 'ERROR');
};

/* ------------------------------ Helpers ------------------------------ */

export interface Paged<T> {
  data: T[];
  pagination: Pagination;
}

export const get = async <T>(url: string, params?: object, config?: AxiosRequestConfig) =>
  (await api.get<{ data: T }>(url, { params, ...config })).data.data;

export const getPaged = async <T>(url: string, params?: object) => {
  const res = await api.get<{ data: T[]; pagination: Pagination }>(url, { params });
  return { data: res.data.data, pagination: res.data.pagination } satisfies Paged<T>;
};

export const post = async <T>(url: string, body?: unknown) => (await api.post<{ data: T; message?: string }>(url, body)).data;
export const patch = async <T>(url: string, body?: unknown) => (await api.patch<{ data: T; message?: string }>(url, body)).data;
export const put = async <T>(url: string, body?: unknown) => (await api.put<{ data: T; message?: string }>(url, body)).data;
export const del = async <T>(url: string) => (await api.delete<{ data: T; message?: string }>(url)).data;

/**
 * Uploads go through the web host's /api proxy, which turns away bodies over ~4.5 MB (a phone camera photo is often
 * 5–15 MB). Large JPEG / PNG / WebP pictures are scaled down to 2400 px and re-encoded as JPEG first (plenty for
 * photos and scanned documents); anything else, or a picture that can't be read, is sent as it is.
 */
const MAX_DIRECT_UPLOAD = 4 * 1024 * 1024;
const shrinkImage = async (file: File): Promise<File> => {
  if (file.size <= MAX_DIRECT_UPLOAD || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const g = canvas.getContext('2d');
    if (!g) return file;
    g.fillStyle = '#ffffff'; // transparent PNG areas become white, not black
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], `${file.name.replace(/\.(png|webp|jpe?g)$/i, '')}.jpg`, { type: 'image/jpeg' });
  } catch {
    return file;
  }
};

export const upload = async <T>(url: string, file: File, fields: Record<string, string | undefined> = {}) => {
  const form = new FormData();
  form.append('file', await shrinkImage(file));
  for (const [k, v] of Object.entries(fields)) if (v !== undefined && v !== '') form.append(k, v);
  return (await api.post<{ data: T; message?: string }>(url, form)).data;
};

/** Downloads a file from an authenticated endpoint and saves it. */
export const downloadFile = async (url: string, params?: object, fallbackName = 'download') => {
  const res = await api.get<Blob>(url, { params, responseType: 'blob' });
  const disposition = String(res.headers['content-disposition'] ?? '');
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);
  const name = match ? decodeURIComponent(match[1]!) : fallbackName;
  const href = URL.createObjectURL(res.data);
  const a = document.createElement('a');
  a.href = href;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
};

/** Opens an authenticated file (PDF/image) in a new tab for preview. */
export const openFile = async (url: string) => {
  const win = window.open('', '_blank');
  const res = await api.get<Blob>(url, { params: { inline: 1 }, responseType: 'blob' });
  const href = URL.createObjectURL(res.data);
  if (win) win.location.href = href;
  else window.location.href = href;
};

/** Fetches an authenticated image as an object URL (for avatars/receipts). */
export const fetchObjectUrl = async (url: string) => {
  const res = await api.get<Blob>(url, { responseType: 'blob', baseURL: '' });
  return URL.createObjectURL(res.data);
};
