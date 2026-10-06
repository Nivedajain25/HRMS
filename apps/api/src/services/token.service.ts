import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { randomToken, sha256 } from '../utils/crypto';

export interface AccessTokenPayload {
  sub: string;
  org: string;
  ver: number;
}

const durationToSeconds = (value: string): number => {
  const match = /^(\d+)([smhd])$/.exec(value);
  if (!match) return Number(value) || 900;
  const n = Number(match[1]);
  return n * { s: 1, m: 60, h: 3600, d: 86400 }[match[2] as 's' | 'm' | 'h' | 'd'];
};

export const accessTokenTtl = () => durationToSeconds(env.JWT_ACCESS_EXPIRES);
export const refreshTokenTtl = (rememberMe: boolean) =>
  durationToSeconds(rememberMe ? env.JWT_REFRESH_EXPIRES : env.JWT_REFRESH_SHORT_EXPIRES);

export const signAccessToken = (payload: AccessTokenPayload) =>
  jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    expiresIn: accessTokenTtl(),
    algorithm: 'HS256',
    issuer: 'stencil-hrms',
    audience: 'stencil-hrms-api',
  });

export const verifyAccessToken = (token: string): AccessTokenPayload => {
  const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET, {
    algorithms: ['HS256'],
    issuer: 'stencil-hrms',
    audience: 'stencil-hrms-api',
  });
  if (typeof decoded === 'string') throw new Error('Invalid token payload');
  return decoded as unknown as AccessTokenPayload;
};

/**
 * Refresh tokens are opaque random values (not JWTs), HMAC'd with the refresh
 * secret before hashing so a DB leak alone can't be used to mint sessions.
 */
export const createRefreshToken = () => {
  const token = randomToken(48);
  return { token, hash: hashRefreshToken(token) };
};
export const hashRefreshToken = (token: string) => sha256(`${env.JWT_REFRESH_SECRET}:${token}`);
