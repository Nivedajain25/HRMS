/** Standard success envelope returned by every API endpoint. */
export interface ApiSuccess<T> {
  success: true;
  data: T;
  message?: string;
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface ApiPaginated<T> {
  success: true;
  data: T[];
  pagination: Pagination;
  message?: string;
}

export interface ApiFieldError {
  path: string;
  message: string;
}

export interface ApiError {
  success: false;
  message: string;
  code: string;
  errors: ApiFieldError[];
}

export interface Ref {
  _id: string;
  name?: string;
}

export interface EmployeeRef {
  _id: string;
  employeeId: string;
  firstName: string;
  lastName: string;
  profilePhoto?: string | null;
  workEmail?: string;
}

export interface AuthUser {
  _id: string;
  email: string;
  firstName: string;
  lastName: string;
  avatar?: string | null;
  status: string;
  emailVerified: boolean;
  employeeId: string | null;
  roles: { _id: string; name: string; key?: string }[];
  permissions: string[];
  isManager: boolean;
  /** theme: one of THEME_PREFERENCES in @stencil/shared. */
  preferences: { theme: 'system' | 'light' | 'sand' | 'lavender' | 'dark' | 'midnight' | 'navy' | 'plum' | 'graphite'; language: string };
  organization: {
    _id: string;
    name: string;
    logo?: string | null;
    timezone: string;
    currency: string;
    dateFormat: string;
  };
}

export interface AuthSession {
  user: AuthUser;
  accessToken: string;
  expiresIn: number;
}

/**
 * Session returned to native clients (`X-Client: mobile`). The refresh token is
 * delivered in the body instead of an HTTP-only cookie.
 *
 * `refreshToken` / `refreshExpiresIn` are `null` only on `POST /auth/refresh`
 * when the presented token was rotated moments ago by a concurrent request
 * (30 s grace window): the client must KEEP the refresh token it has stored
 * (or the one the concurrent request returned) and only use the new access token.
 */
export interface MobileAuthSession extends AuthSession {
  refreshToken: string | null;
  /** Seconds until the refresh token expires. */
  refreshExpiresIn: number | null;
}

export type SessionClient = 'web' | 'mobile';

export interface ActiveSession {
  _id: string;
  client: SessionClient;
  ipAddress?: string;
  userAgent?: string;
  rememberMe: boolean;
  createdAt: string;
  lastUsedAt?: string;
  expiresAt: string;
}

export interface RegisteredDevice {
  _id: string;
  token: string;
  platform: 'android' | 'ios';
  appVersion?: string | null;
  deviceName?: string | null;
  lastSeenAt: string;
  disabledAt: string | null;
  createdAt: string;
}

export interface SearchResult {
  type:
    | 'employee'
    | 'candidate'
    | 'department'
    | 'designation'
    | 'asset'
    | 'document'
    | 'leave'
    | 'announcement';
  id: string;
  title: string;
  subtitle?: string;
  url: string;
}
