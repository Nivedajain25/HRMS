import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { AuditLogModel, OrganizationModel, RoleModel, SessionModel, UserModel } from '../../src/models';
import { hashRefreshToken } from '../../src/services/token.service';
import { PASSWORD, as, cookieValue, getApp, registerOrg, tokenFromEmail, uniqueEmail } from '../helpers';

const refreshWith = (cookie: string | undefined) =>
  request(getApp()).post('/api/v1/auth/refresh').set('X-Requested-With', 'XMLHttpRequest').set('Cookie', cookie ?? '');

describe('Authentication', () => {
  it('registers an organization with a super admin, system roles and defaults', async () => {
    const { user, token } = await registerOrg({ country: 'India' });
    expect(user.roles[0].key).toBe('super_admin');
    expect(user.permissions).toContain('settings:manage');
    expect(user.employeeId).toBeTruthy();

    const roles = await RoleModel.find({ organizationId: user.organization._id }).lean();
    expect(roles.map((r) => r.key).sort()).toEqual(
      ['employee', 'finance', 'hr_admin', 'hr_manager', 'manager', 'payroll_admin', 'recruiter', 'super_admin'].sort(),
    );
    const org = await OrganizationModel.findById(user.organization._id).lean();
    expect(org?.settings?.payroll?.countryRules).toBe('IN');

    const me = await as(token).get('/api/v1/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.data.email).toBe(user.email);
    expect(me.body.data).not.toHaveProperty('passwordHash');
  });

  it('rejects duplicate registration and weak passwords', async () => {
    const { email } = await registerOrg();
    const dup = await request(getApp())
      .post('/api/v1/auth/register')
      .send({ organizationName: 'X', firstName: 'A', lastName: 'B', email, password: PASSWORD });
    expect(dup.status).toBe(409);

    const weak = await request(getApp())
      .post('/api/v1/auth/register')
      .send({ organizationName: 'X', firstName: 'A', lastName: 'B', email: uniqueEmail(), password: 'short' });
    expect(weak.status).toBe(400);
    expect(weak.body.code).toBe('VALIDATION_ERROR');
  });

  it('logs in, rejects bad credentials with a generic message, and records audit events', async () => {
    const { email, user } = await registerOrg();
    const bad = await request(getApp()).post('/api/v1/auth/login').send({ email, password: 'Wrong1234' });
    expect(bad.status).toBe(401);
    expect(bad.body.message).toBe('Invalid email or password');
    const unknown = await request(getApp()).post('/api/v1/auth/login').send({ email: uniqueEmail(), password: 'Wrong1234' });
    expect(unknown.body.message).toBe('Invalid email or password');

    const ok = await request(getApp()).post('/api/v1/auth/login').send({ email, password: PASSWORD, rememberMe: true });
    expect(ok.status).toBe(200);
    expect(ok.body.data.accessToken).toBeTruthy();
    const setCookie = ok.headers['set-cookie'] as unknown as string[];
    expect(setCookie.join(';')).toMatch(/stencil_rt=.*HttpOnly/i);

    const actions = await AuditLogModel.find({ organizationId: user.organization._id }).distinct('action');
    expect(actions).toEqual(expect.arrayContaining(['LOGIN', 'LOGIN_FAILED', 'ORGANIZATION_REGISTERED']));
  });

  it('locks the account after repeated failures', async () => {
    const { email } = await registerOrg();
    for (let i = 0; i < 5; i++) {
      await request(getApp()).post('/api/v1/auth/login').send({ email, password: 'Wrong1234' });
    }
    const locked = await request(getApp()).post('/api/v1/auth/login').send({ email, password: PASSWORD });
    expect(locked.status).toBe(401);
    expect(locked.body.code).toBe('ACCOUNT_LOCKED');
  });

  it('rotates refresh tokens and revokes the family on reuse', async () => {
    const { cookie } = await registerOrg();
    const first = cookieValue(cookie, 'stencil_rt');

    const r1 = await refreshWith(first);
    expect(r1.status).toBe(200);
    const second = cookieValue(r1.headers['set-cookie'] as unknown as string[], 'stencil_rt');
    expect(second).not.toBe(first);

    // A replay within the grace window is a concurrent-tab race: access token, no new cookie.
    const race = await refreshWith(first);
    expect(race.status).toBe(200);
    expect(race.headers['set-cookie']).toBeUndefined();

    // After the grace window, replaying the old token is detected as theft...
    await SessionModel.updateOne({ replacedBy: { $ne: null }, revokedAt: { $ne: null } }, { revokedAt: new Date(Date.now() - 60_000) });
    const replay = await refreshWith(first);
    expect(replay.status).toBe(401);
    // ...and the legitimate newer token is revoked too.
    const afterTheft = await refreshWith(second);
    expect(afterTheft.status).toBe(401);
  });

  it('requires the CSRF header for cookie-based refresh', async () => {
    const { cookie } = await registerOrg();
    const res = await request(getApp()).post('/api/v1/auth/refresh').set('Cookie', cookieValue(cookie, 'stencil_rt')!);
    expect(res.status).toBe(403);
  });

  it('logs out and invalidates the refresh cookie', async () => {
    const { cookie } = await registerOrg();
    const rt = cookieValue(cookie, 'stencil_rt');
    const out = await request(getApp()).post('/api/v1/auth/logout').set('X-Requested-With', 'XMLHttpRequest').set('Cookie', rt!);
    expect(out.status).toBe(200);
    expect((await refreshWith(rt)).status).toBe(401);
  });

  it('verifies email with a single-use token', async () => {
    const { email, token } = await registerOrg();
    const verifyToken = tokenFromEmail(email);
    const res = await request(getApp()).post('/api/v1/auth/verify-email').send({ token: verifyToken });
    expect(res.status).toBe(200);
    const me = await as(token).get('/api/v1/auth/me');
    expect(me.body.data.emailVerified).toBe(true);
    const again = await request(getApp()).post('/api/v1/auth/verify-email').send({ token: verifyToken });
    expect(again.status).toBe(400);
  });

  it('resets a forgotten password and revokes existing sessions', async () => {
    const { email, token } = await registerOrg();
    const forgot = await request(getApp()).post('/api/v1/auth/forgot-password').send({ email });
    expect(forgot.status).toBe(200);
    // Unknown emails get the same response.
    const unknown = await request(getApp()).post('/api/v1/auth/forgot-password').send({ email: uniqueEmail() });
    expect(unknown.body.message).toBe(forgot.body.message);

    const resetToken = tokenFromEmail(email);
    const reset = await request(getApp()).post('/api/v1/auth/reset-password').send({ token: resetToken, password: 'N3wPassword!' });
    expect(reset.status).toBe(200);

    // Old access token is revoked via tokenVersion.
    expect((await as(token).get('/api/v1/auth/me')).status).toBe(401);
    expect((await request(getApp()).post('/api/v1/auth/login').send({ email, password: PASSWORD })).status).toBe(401);
    expect((await request(getApp()).post('/api/v1/auth/login').send({ email, password: 'N3wPassword!' })).status).toBe(200);
  });

  it('changes password with current password verification', async () => {
    const { email, token } = await registerOrg();
    const wrong = await as(token).post('/api/v1/auth/change-password', { currentPassword: 'nope', newPassword: 'An0therPass!' });
    expect(wrong.status).toBe(400);
    const ok = await as(token).post('/api/v1/auth/change-password', { currentPassword: PASSWORD, newPassword: 'An0therPass!' });
    expect(ok.status).toBe(200);
    expect((await as(ok.body.data.accessToken).get('/api/v1/auth/me')).status).toBe(200);
    expect((await request(getApp()).post('/api/v1/auth/login').send({ email, password: 'An0therPass!' })).status).toBe(200);
  });

  it('blocks deactivated users immediately', async () => {
    const { token, user } = await registerOrg();
    await UserModel.updateOne({ _id: user._id }, { status: 'SUSPENDED', $inc: { tokenVersion: 1 } });
    expect((await as(token).get('/api/v1/auth/me')).status).toBe(401);
  });

  it('rejects requests without or with tampered tokens', async () => {
    expect((await request(getApp()).get('/api/v1/auth/me')).status).toBe(401);
    const { token } = await registerOrg();
    const tampered = token.slice(0, -2) + (token.endsWith('a') ? 'bb' : 'aa');
    expect((await as(tampered).get('/api/v1/auth/me')).status).toBe(401);
  });

  it('strips Mongo operators from input (NoSQL injection)', async () => {
    const res = await request(getApp())
      .post('/api/v1/auth/login')
      .send({ email: { $gt: '' }, password: { $gt: '' } });
    expect(res.status).toBe(400);
  });
});

describe('mobile client', () => {
  const mobile = (url: string) => request(getApp()).post(url).set('X-Client', 'mobile');
  const mobileLogin = async (email: string) => {
    const res = await mobile('/api/v1/auth/login').send({ email, password: PASSWORD });
    expect(res.status).toBe(200);
    return res;
  };
  const mobileRefresh = (refreshToken: unknown) => mobile('/api/v1/auth/refresh').send({ refreshToken });

  it('login returns the refresh token in the body and sets no cookie', async () => {
    const { email } = await registerOrg();
    const res = await mobileLogin(email);
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(res.body.data.accessToken).toBeTruthy();
    expect(res.body.data.expiresIn).toBeGreaterThan(0);
    expect(res.body.data.user.email).toBe(email);
    expect(typeof res.body.data.refreshToken).toBe('string');
    expect(res.body.data.refreshToken.length).toBeGreaterThanOrEqual(64);
    expect(res.body.data.refreshExpiresIn).toBeGreaterThan(0);

    // Sessions record the client kind.
    const session = await SessionModel.findOne({ tokenHash: hashRefreshToken(res.body.data.refreshToken) }).lean();
    expect(session?.client).toBe('mobile');
    const list = await as(res.body.data.accessToken).get('/api/v1/auth/sessions');
    expect(list.body.data.map((s: { client: string }) => s.client)).toEqual(expect.arrayContaining(['mobile', 'web']));
  });

  it('web login still sets the cookie and never returns the refresh token in the body', async () => {
    const { email, cookie } = await registerOrg();
    expect(cookieValue(cookie, 'stencil_rt')).toBeTruthy();
    const res = await request(getApp()).post('/api/v1/auth/login').send({ email, password: PASSWORD });
    expect(res.status).toBe(200);
    expect(cookieValue(res.headers['set-cookie'] as unknown as string[], 'stencil_rt')).toBeTruthy();
    expect(res.body.data).not.toHaveProperty('refreshToken');
    expect(res.body.data).not.toHaveProperty('refreshExpiresIn');
    expect(Object.keys(res.body.data).sort()).toEqual(['accessToken', 'expiresIn', 'user']);
    // Header value must be exactly "mobile".
    const other = await request(getApp()).post('/api/v1/auth/login').set('X-Client', 'Mobile').send({ email, password: PASSWORD });
    expect(other.body.data).not.toHaveProperty('refreshToken');
    expect(other.headers['set-cookie']).toBeDefined();
  });

  it('register, accept-invite and change-password return body tokens in mobile mode', async () => {
    const { token } = await registerOrg();
    const reg = await mobile('/api/v1/auth/register').send({
      organizationName: 'Mobile Org',
      firstName: 'Mo',
      lastName: 'Bile',
      email: uniqueEmail('mob'),
      password: PASSWORD,
    });
    expect(reg.status).toBe(201);
    expect(reg.headers['set-cookie']).toBeUndefined();
    expect(reg.body.data.refreshToken).toBeTruthy();

    const inviteEmail = uniqueEmail('invitee');
    const created = await as(token).post('/api/v1/employees', {
      firstName: 'In',
      lastName: 'Vitee',
      workEmail: inviteEmail,
      joiningDate: '2024-01-15',
      createUserAccount: true,
    });
    expect(created.status).toBe(201);
    const accepted = await mobile('/api/v1/auth/accept-invite').send({ token: tokenFromEmail(inviteEmail), password: PASSWORD });
    expect(accepted.status).toBe(200);
    expect(accepted.headers['set-cookie']).toBeUndefined();
    expect(accepted.body.data.refreshToken).toBeTruthy();
    expect(accepted.body.data.refreshExpiresIn).toBeGreaterThan(0);

    const changed = await request(getApp())
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${token}`)
      .set('x-client', 'mobile')
      .send({ currentPassword: PASSWORD, newPassword: 'An0therPass!' });
    expect(changed.status).toBe(200);
    expect(changed.headers['set-cookie']).toBeUndefined();
    expect(changed.body.data.refreshToken).toBeTruthy();
    expect((await mobileRefresh(changed.body.data.refreshToken)).status).toBe(200);
  });

  it('refresh with body rotates without the CSRF header; replay after the grace window revokes the family', async () => {
    const { email } = await registerOrg();
    const first = (await mobileLogin(email)).body.data.refreshToken as string;

    const r1 = await mobileRefresh(first);
    expect(r1.status).toBe(200);
    expect(r1.headers['set-cookie']).toBeUndefined();
    const second = r1.body.data.refreshToken as string;
    expect(second).toBeTruthy();
    expect(second).not.toBe(first);
    expect(r1.body.data.refreshExpiresIn).toBeGreaterThan(0);
    expect(r1.body.data.accessToken).toBeTruthy();
    const rotated = await SessionModel.findOne({ tokenHash: hashRefreshToken(second) }).lean();
    expect(rotated?.client).toBe('mobile');

    // Concurrent replay within the grace window: access token, but no new refresh token.
    const race = await mobileRefresh(first);
    expect(race.status).toBe(200);
    expect(race.body.data.accessToken).toBeTruthy();
    expect(race.body.data.refreshToken).toBeNull();
    expect(race.body.data.refreshExpiresIn).toBeNull();

    // After the grace window the replay is theft: the family is revoked.
    await SessionModel.updateOne({ tokenHash: hashRefreshToken(first) }, { revokedAt: new Date(Date.now() - 60_000) });
    const replay = await mobileRefresh(first);
    expect(replay.status).toBe(401);
    expect(replay.body.code).toBe('SESSION_REVOKED');
    expect((await mobileRefresh(second)).status).toBe(401);
  });

  it('validates the mobile refresh body', async () => {
    expect((await mobile('/api/v1/auth/refresh').send({})).status).toBe(400);
    expect((await mobileRefresh('short')).status).toBe(400);
    expect((await mobileRefresh('a'.repeat(96))).status).toBe(401);
    // Web refresh (no header) still needs the CSRF header and ignores the body.
    expect((await request(getApp()).post('/api/v1/auth/refresh').send({ refreshToken: 'a'.repeat(96) })).status).toBe(403);
  });

  it('logout revokes the session identified by the body token', async () => {
    const { email } = await registerOrg();
    const rt = (await mobileLogin(email)).body.data.refreshToken as string;
    const out = await mobile('/api/v1/auth/logout').send({ refreshToken: rt });
    expect(out.status).toBe(200);
    expect(out.headers['set-cookie']).toBeUndefined();
    const session = await SessionModel.findOne({ tokenHash: hashRefreshToken(rt) }).lean();
    expect(session?.revokedAt).toBeTruthy();
    expect((await mobileRefresh(rt)).status).toBe(401);
  });
});
