import {
  acceptInviteSchema,
  avatarUpdateSchema,
  changePasswordSchema,
  forgotPasswordSchema,
  idParam,
  loginSchema,
  mobileLogoutSchema,
  mobileRefreshSchema,
  registerSchema,
  resetPasswordSchema,
  verifyEmailSchema,
} from '@stencil/shared';
import * as c from '../controllers/auth.controller';
import { csrfOrMobileBody } from '../middleware/client';
import { authLimiter } from '../middleware/security';
import { createModule } from './registry';

const m = createModule('Auth', '/api/v1/auth');
const limited = [authLimiter];

/*
 * Client modes
 *  - Web (default): the rotating refresh token lives in the HTTP-only `stencil_rt`
 *    cookie (path /api/v1/auth); refresh/logout require `X-Requested-With: XMLHttpRequest`.
 *  - Mobile (`X-Client: mobile`): no cookie is set or read. Session responses add
 *    `refreshToken` + `refreshExpiresIn` (seconds) to `data`; refresh/logout take
 *    `{ refreshToken }` in the JSON body and do not need the CSRF header.
 */
const SESSION_DESC =
  'Web: sets the HTTP-only `stencil_rt` refresh cookie; `data` = `{ user, accessToken, expiresIn }`. ' +
  'Mobile (`X-Client: mobile`): no cookie; `data` additionally contains `refreshToken` and `refreshExpiresIn` (seconds). Store the refresh token in secure storage (Keychain/Keystore).';
const REFRESH_DESC =
  'Rotates the refresh token (single use) and returns a new access token.\n\n' +
  '**Web:** reads the `stencil_rt` cookie, requires `X-Requested-With: XMLHttpRequest`, sets the successor cookie.\n\n' +
  '**Mobile (`X-Client: mobile`):** body `{ refreshToken }`, no CSRF header. Response `data` = `{ user, accessToken, expiresIn, refreshToken, refreshExpiresIn }`; ' +
  'replace the stored token with the returned one. If `refreshToken` is `null`, the presented token was rotated by a concurrent request less than 30 s ago: ' +
  'use the new access token but KEEP the refresh token delivered to that concurrent request (the server cannot re-send it). ' +
  'Presenting an already-rotated token after the grace window is treated as theft and revokes the whole session family (401 `SESSION_REVOKED`) — serialize refreshes on the client.';

m.route(
  { method: 'post', path: '/register', summary: 'Register an organization and its first Super Admin', description: SESSION_DESC, mobileClientHeader: true, public: true, body: registerSchema, before: limited },
  c.register,
);
m.route({ method: 'post', path: '/login', summary: 'Sign in', description: SESSION_DESC, mobileClientHeader: true, public: true, body: loginSchema, before: limited }, c.login);
m.route(
  {
    method: 'post',
    path: '/refresh',
    summary: 'Rotate the refresh token and get a new access token',
    description: REFRESH_DESC,
    mobileClientHeader: true,
    public: true,
    docBody: mobileRefreshSchema,
    before: [csrfOrMobileBody(mobileRefreshSchema)],
  },
  c.refresh,
);
m.route(
  {
    method: 'post',
    path: '/logout',
    summary: 'Sign out of this device',
    description:
      'Revokes the current session. **Web:** cookie + `X-Requested-With: XMLHttpRequest`; clears the cookie. **Mobile (`X-Client: mobile`):** body `{ refreshToken }`; unregister the push token (`DELETE /devices/:token`) first. Always succeeds for unknown tokens.',
    mobileClientHeader: true,
    public: true,
    docBody: mobileLogoutSchema,
    before: [csrfOrMobileBody(mobileLogoutSchema)],
  },
  c.logout,
);
m.route({ method: 'post', path: '/logout-all', summary: 'Sign out of all devices', description: 'Revokes every session and removes all registered push devices.' }, c.logoutAll);
m.route({ method: 'get', path: '/me', summary: 'Current user, roles, permissions and organization' }, c.me);
m.route(
  {
    method: 'patch',
    path: '/me/avatar',
    summary: 'Set or remove my profile photo',
    description: 'Upload the image first with `POST /files` (context `AVATAR`), then pass its id; `null` removes the photo. Also updates the linked employee record’s photo.',
    body: avatarUpdateSchema,
  },
  c.setAvatar,
);
m.route({ method: 'post', path: '/forgot-password', summary: 'Request a password reset email', public: true, body: forgotPasswordSchema, before: limited }, c.forgotPassword);
m.route({ method: 'post', path: '/reset-password', summary: 'Reset password with a token', public: true, body: resetPasswordSchema, before: limited }, c.resetPassword);
m.route({ method: 'post', path: '/verify-email', summary: 'Verify email address', public: true, body: verifyEmailSchema, before: limited }, c.verifyEmail);
m.route({ method: 'post', path: '/resend-verification', summary: 'Resend verification email', before: limited }, c.resendVerification);
m.route(
  {
    method: 'post',
    path: '/change-password',
    summary: 'Change password (signs out other devices)',
    description: `${SESSION_DESC} All other sessions and all push devices are revoked — mobile clients must store the new refresh token and re-register their push token.`,
    mobileClientHeader: true,
    body: changePasswordSchema,
    before: limited,
  },
  c.changePassword,
);
m.route(
  { method: 'post', path: '/accept-invite', summary: 'Activate an invited account', description: SESSION_DESC, mobileClientHeader: true, public: true, body: acceptInviteSchema, before: limited },
  c.acceptInvite,
);
m.route({ method: 'get', path: '/sessions', summary: 'List active sessions', description: 'Each session has `client`: `web` or `mobile` (show "Mobile app").' }, c.sessions);
m.route({ method: 'delete', path: '/sessions/:id', summary: 'Revoke a session', params: idParam }, c.revokeSession);

export default m;
