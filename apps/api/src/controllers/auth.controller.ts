import type { CookieOptions, Request, Response } from 'express';
import type { ChangePasswordInput, LoginInput, MobileLogoutInput, MobileRefreshInput, RegisterInput } from '@stencil/shared';
import { env, isProd } from '../config/env';
import { getCtx } from '../middleware/auth';
import { isMobileClient } from '../middleware/client';
import { body } from '../middleware/validate';
import * as authService from '../services/auth.service';
import { ok } from '../utils/response';

export const REFRESH_COOKIE = 'stencil_rt';

const cookieOptions = (maxAgeSeconds?: number): CookieOptions => ({
  httpOnly: true,
  secure: env.COOKIE_SECURE || isProd,
  sameSite: 'strict',
  path: '/api/v1/auth',
  domain: env.COOKIE_DOMAIN || undefined,
  ...(maxAgeSeconds ? { maxAge: maxAgeSeconds * 1000 } : {}),
});

const meta = (req: Request): authService.ClientMeta => ({
  ipAddress: req.ip,
  userAgent: req.get('user-agent') ?? undefined,
  client: isMobileClient(req) ? 'mobile' : 'web',
});

/**
 * Web: the refresh token goes into the HTTP-only cookie; the body is the plain
 * `AuthSession` (never contains the refresh token).
 * Mobile (`X-Client: mobile`): no cookie; the body is `MobileAuthSession`
 * = AuthSession + `refreshToken` + `refreshExpiresIn` (seconds). Both are
 * `null` in the concurrent-refresh grace case — the client keeps its stored token.
 */
const sendSession = (
  req: Request,
  res: Response,
  result: { session: object; refreshToken: string | null; refreshTtl: number },
  message?: string,
  status = 200,
) => {
  if (isMobileClient(req)) {
    return ok(
      res,
      { ...result.session, refreshToken: result.refreshToken, refreshExpiresIn: result.refreshToken ? result.refreshTtl : null },
      message,
      status,
    );
  }
  // A null token means "keep the cookie the browser already has" (concurrent refresh grace).
  if (result.refreshToken) res.cookie(REFRESH_COOKIE, result.refreshToken, cookieOptions(result.refreshTtl));
  return ok(res, result.session, message, status);
};

const refreshCookie = (req: Request): string | undefined => {
  const value = (req.cookies as Record<string, unknown> | undefined)?.[REFRESH_COOKIE];
  return typeof value === 'string' ? value : undefined;
};

/** Mobile: validated body token (see `csrfOrMobileBody`). Web: the cookie. */
const presentedRefreshToken = (req: Request) =>
  isMobileClient(req) ? body<MobileRefreshInput | MobileLogoutInput>(req)?.refreshToken : refreshCookie(req);

export const register = async (req: Request, res: Response) => {
  const result = await authService.register(body<RegisterInput>(req), meta(req));
  sendSession(req, res, result, 'Organization created. Please verify your email.', 201);
};

export const login = async (req: Request, res: Response) => {
  const result = await authService.login(body<LoginInput>(req), meta(req));
  sendSession(req, res, result, 'Signed in');
};

export const refresh = async (req: Request, res: Response) => {
  try {
    const result = await authService.refresh(presentedRefreshToken(req), meta(req));
    sendSession(req, res, result);
  } catch (err) {
    if (!isMobileClient(req)) res.clearCookie(REFRESH_COOKIE, cookieOptions());
    throw err;
  }
};

export const logout = async (req: Request, res: Response) => {
  await authService.logout(presentedRefreshToken(req), meta(req));
  if (!isMobileClient(req)) res.clearCookie(REFRESH_COOKIE, cookieOptions());
  ok(res, null, 'Signed out');
};

export const logoutAll = async (req: Request, res: Response) => {
  await authService.revokeAllSessions(getCtx(req).userId);
  if (!isMobileClient(req)) res.clearCookie(REFRESH_COOKIE, cookieOptions());
  ok(res, null, 'Signed out of all devices');
};

export const me = async (req: Request, res: Response) => {
  ok(res, await authService.buildAuthUser(getCtx(req).userId));
};

export const setAvatar = async (req: Request, res: Response) => {
  ok(res, await authService.setMyAvatar(getCtx(req).userId, body<{ fileId: string | null }>(req).fileId), 'Profile photo updated');
};

export const forgotPassword = async (req: Request, res: Response) => {
  await authService.forgotPassword(body<{ email: string }>(req).email);
  ok(res, null, 'If an account exists for that email, a reset link has been sent.');
};

export const resetPassword = async (req: Request, res: Response) => {
  const { token, password } = body<{ token: string; password: string }>(req);
  await authService.resetPassword(token, password, meta(req));
  ok(res, null, 'Password updated. You can now sign in.');
};

export const verifyEmail = async (req: Request, res: Response) => {
  await authService.verifyEmail(body<{ token: string }>(req).token);
  ok(res, null, 'Email verified');
};

export const resendVerification = async (req: Request, res: Response) => {
  await authService.resendVerification(getCtx(req).userId);
  ok(res, null, 'Verification email sent');
};

export const changePassword = async (req: Request, res: Response) => {
  const { currentPassword, newPassword } = body<ChangePasswordInput>(req);
  const result = await authService.changePassword(getCtx(req).userId, currentPassword, newPassword, meta(req));
  sendSession(req, res, result, 'Password changed');
};

export const acceptInvite = async (req: Request, res: Response) => {
  const { token, password } = body<{ token: string; password: string }>(req);
  sendSession(req, res, await authService.acceptInvite(token, password, meta(req)), 'Account activated');
};

export const sessions = async (req: Request, res: Response) => {
  ok(res, await authService.listSessions(getCtx(req).userId));
};

export const revokeSession = async (req: Request, res: Response) => {
  await authService.revokeSession(getCtx(req).userId, String(req.params.id));
  ok(res, null, 'Session revoked');
};
