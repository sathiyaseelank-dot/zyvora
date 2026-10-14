import { randomBytes } from 'node:crypto';
import type { CookieOptions, Response } from 'express';

import { env } from '../config/env.js';
import { SESSION_COOKIE } from './jwt.js';

/**
 * Session transport and CSRF — Story ZYV-56 / E6-S7.
 *
 * The token itself is minted and verified in `auth/jwt.ts`. This file owns how
 * it travels and how a state-changing request proves it came from our own page.
 *
 * Transport rules, which are the whole point:
 *   - HttpOnly   — JavaScript cannot read it, so XSS cannot exfiltrate it
 *   - Secure     — production only; a plain-HTTP dev server still works
 *   - SameSite   — Lax, which survives a top-level navigation from a payment
 *                  gateway redirect while still blocking cross-site POSTs
 *
 * The CSRF token is NOT the session cookie and is a separate random value: the
 * frontend must read it and echo it in a header, and a cross-site attacker can
 * neither read it nor forge the matching pair.
 */

export { SESSION_COOKIE };

export const CSRF_COOKIE = 'zyvora_csrf';
export const CSRF_HEADER = 'x-csrf-token';

function baseCookie(): CookieOptions {
  return {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
  };
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
 * Issue a CSRF cookie, returning the token.
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
  claims: { sub: string; role: string; email: string },
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
