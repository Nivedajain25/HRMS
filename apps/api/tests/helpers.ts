import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../src/app';
import { sentEmails } from '../src/services/email.service';

let app: Express | undefined;
export const getApp = () => (app ??= createApp());

export const PASSWORD = 'Str0ngPass!';

let seq = 0;
export const uniqueEmail = (prefix = 'user') => `${prefix}.${Date.now()}.${++seq}@example.test`;

/** Registers a fresh organization; returns the super admin's token and profile. */
export const registerOrg = async (overrides: Record<string, unknown> = {}) => {
  const email = uniqueEmail('admin');
  const res = await request(getApp())
    .post('/api/v1/auth/register')
    .send({
      organizationName: `Org ${++seq}`,
      firstName: 'Ada',
      lastName: 'Admin',
      email,
      password: PASSWORD,
      timezone: 'UTC',
      currency: 'USD',
      ...overrides,
    });
  if (res.status !== 201) throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
  return {
    token: res.body.data.accessToken as string,
    user: res.body.data.user,
    email,
    cookie: res.headers['set-cookie'] as unknown as string[],
  };
};

export const login = async (email: string, password = PASSWORD) => {
  const res = await request(getApp()).post('/api/v1/auth/login').send({ email, password });
  if (res.status !== 200) throw new Error(`login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data.accessToken as string;
};

/** Authenticated request helpers. */
export const as = (token: string) => {
  const a = getApp();
  return {
    get: (url: string) => request(a).get(url).set('Authorization', `Bearer ${token}`),
    post: (url: string, body?: object) => request(a).post(url).set('Authorization', `Bearer ${token}`).send(body ?? {}),
    patch: (url: string, body?: object) => request(a).patch(url).set('Authorization', `Bearer ${token}`).send(body ?? {}),
    put: (url: string, body?: object) => request(a).put(url).set('Authorization', `Bearer ${token}`).send(body ?? {}),
    delete: (url: string) => request(a).delete(url).set('Authorization', `Bearer ${token}`),
    upload: (url: string) => request(a).post(url).set('Authorization', `Bearer ${token}`),
  };
};

/** Looks up role ids by system key for the admin's organization. */
export const roleIds = async (adminToken: string, keys: string[]) => {
  const res = await as(adminToken).get('/api/v1/roles');
  const roles = res.body.data as { _id: string; key?: string }[];
  return keys.map((k) => {
    const r = roles.find((x) => x.key === k);
    if (!r) throw new Error(`Role ${k} not found`);
    return r._id;
  });
};

/**
 * Creates an employee with a user account (optionally extra roles), accepts
 * the invitation and returns the employee plus a signed-in access token.
 */
export const createEmployeeUser = async (
  adminToken: string,
  opts: { roles?: string[]; managerId?: string; firstName?: string; [k: string]: unknown } = {},
) => {
  const { roles = [], ...rest } = opts;
  const email = uniqueEmail(String(opts.firstName ?? 'emp').toLowerCase());
  const res = await as(adminToken)
    .post('/api/v1/employees', {
      firstName: 'Test',
      lastName: 'Person',
      workEmail: email,
      joiningDate: '2024-01-15',
      gender: 'FEMALE',
      createUserAccount: true,
      roleIds: roles.length ? await roleIds(adminToken, roles) : undefined,
      ...rest,
    });
  if (res.status !== 201) throw new Error(`create employee failed: ${res.status} ${JSON.stringify(res.body)}`);
  const invite = tokenFromEmail(email);
  const accept = await request(getApp()).post('/api/v1/auth/accept-invite').send({ token: invite, password: PASSWORD });
  if (accept.status !== 200) throw new Error(`accept invite failed: ${JSON.stringify(accept.body)}`);
  return { employee: res.body.data, token: accept.body.data.accessToken as string, email };
};

export const lastEmailTo =(to: string) => [...sentEmails].reverse().find((e) => e.to === to);

export const tokenFromEmail = (to: string) => {
  const email = lastEmailTo(to);
  const match = email?.text.match(/token=([a-f0-9]+)/);
  if (!match) throw new Error(`No token email for ${to}`);
  return match[1]!;
};

export const cookieValue = (setCookie: string[] | string | undefined, name: string) => {
  const list = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  const c = list.find((x) => x.startsWith(`${name}=`));
  return c?.split(';')[0];
};
