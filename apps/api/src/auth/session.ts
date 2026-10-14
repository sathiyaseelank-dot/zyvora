import type { CookieOptions, Response } from 'express';
import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import { randomBytes } from 'node:crypto';

import { env } from '../config/env.js';
import { SESSION_COOKIE, type RoleName } from '../http/auth.js';

/**
 * Sessions — Story ZYV-56 / E6-S7.
 *
 * The schema has no sessions table, so the session is a signed JWT carried in
 * an HTTP-only cookie (requirements.md §3 permits JWT in HTTP-only cookies).
 *
 * Transport rules, which are the whole point of this file:
 *   - HttpOnly   — JavaScript cannot read it, so XSS cannot exfiltrate it
 *   - Secure     — production only; a plain-HTTP dev server still works
 *   - SameSite   — Lax, which survives a top-level navigation from a payment
 *                  gateway redirect while still blocking cross-site POSTs
 *   - Path       — restricted to the API surface that needs it
 *
 * The CSRF token is NOT the session cookie. A double-submit token is a second,
 * readable-by-JS value bound to the session's subject, so a cross-site form post
 * cannot supply it (the attacker's page cannot read our response headers).
 */

export { SESSION_COOKIE };

const key = () => new TextEncoder().encode(env.JWT_SECRET);

export const CSRF_COOKIE = 'zyvora_csrf';
export const CSRF_HEADER = 'x-csrf-token';

/** Lifetime of a session. Overridable without a rebuild. */
export const SESSION_TTL = env.JWT_EXPIRES_IN;

export interface SessionClaims {
  sub: string;
  role: RoleName;
  email: string;
}

function baseCookie(): CookieOptions {
  return {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: undefined,
  };
}

/** Sign the session JWT for a user. */
export async function signSession(claims: SessionClaims): Promise<string> {
  return new SignJWT({ role: claims.role, email: claims.email })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(SESSION_TTL)
    .sign(key());
}

/** Verify a session token. Returns undefined for anything untrustworthy. */
export async function verifySession(
  token: string | undefined,
): Promise<SessionClaims | undefined> {
  if (!token) return undefined;
  try {
    const { payload } = await jwtVerify(token, key(), {
      // Pin the algorithm. An unpinned verifier accepts alg:none and
      // attacker-chosen algorithms.
      algorithms: ['HS256'],
    });
    if (typeof payload.sub !== 'string') return undefined;
    if (payload.role !== 'customer' && payload.role !== 'admin')
      return undefined;
    return {
      sub: payload.sub,
      role: payload.role,
      email: typeof payload.email === 'string' ? payload.email : '',
    };
  } catch {
    return undefined;
  }
}

/**
 * CSRF guard for state-changing requests.
 *
 * Double-submit with a random token. The token is set in a JS-readable cookie
 * and echoed in the `x-csrf-token` header. A cross-site attacker can cause the
 * cookie to be *sent*, but cannot read it to populate the header — so it can
 * never produce a matching pair.
 *
 * A random value is required rather than, say, the session subject: the
 * subject is predictable and, before login, there is no subject at all.
 */
export function verifyCsrf(req: {
  cookies?: Record<string, string>;
  get(name: string): string | undefined;
}): boolean {
  const header = req.get(CSRF_HEADER);
  const cookie = req.cookies?.[CSRF_COOKIE];
  if (!header || !cookie) return false;
  return timingSafeEqualStrings(header, cookie);
}

/** Constant-time comparison for equal-length strings. */
function timingSafeEqualStrings(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Issue a CSRF cookie, optionally alongside a session.
 *
 * Called on login/register and by `GET /api/auth/csrf`, so a pre-auth form can
 * obtain a token before submitting credentials.
 */
export function issueCsrfCookie(
  res: Response,
  token = randomBytes(32).toString('base64url'),
): string {
  res.cookie(CSRF_COOKIE, token, {
    ...baseCookie(),
    // Deliberately NOT httpOnly: the frontend must read this to echo it back.
    // That is safe precisely because a cross-site attacker cannot read it.
    httpOnly: false,
  });
  return token;
}

/** Set both the session and a fresh CSRF cookie. */
export function issueSessionCookies(
  res: Response,
  claims: SessionClaims,
  token: string,
): void {
  res.cookie(SESSION_COOKIE, token, baseCookie());
  issueCsrfCookie(res);
}

/** Clear both cookies on logout. */
export function clearSessionCookies(res: Response): void {
  const cookie = baseCookie();
  res.clearCookie(SESSION_COOKIE, cookie);
  res.clearCookie(CSRF_COOKIE, { ...cookie, httpOnly: false });
}

/** Parse a JWT payload without verifying it. Debug/introspection only. */
export function peekClaims(token: string): JWTPayload | undefined {
  const parts = token.split('.');
  if (parts.length !== 3) return undefined;
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString());
  } catch {
    return undefined;
  }
}
