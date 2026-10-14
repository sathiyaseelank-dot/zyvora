import { SignJWT, jwtVerify, type JWTPayload } from 'jose';

import { env } from '../config/env.js';

/**
 * The one implementation of ZYVORA's session tokens.
 *
 * This logic previously existed twice — here in `auth/session.ts` and again
 * inside `http/auth.ts` for `resolveUser` — with separate copies of the
 * algorithm pinning, the role allow-list and the expiry handling. Two copies of
 * a security control is one more than there should be: they can drift, and a
 * fix applied to one would silently leave the other permissive.
 *
 * Everything below is transport-independent. Cookie handling and CSRF live in
 * `auth/session.ts`; request authentication lives in `http/auth.ts`.
 */

/** Name of the session cookie. Referenced by ADR-001. */
export const SESSION_COOKIE = 'zyvora_session';

export type RoleName = 'customer' | 'admin';

export interface SessionClaims {
  sub: string;
  role: RoleName;
  email: string;
  /** Issued-at seconds, used to honour session revocation. */
  issuedAt?: number;
}

/**
 * Lifetime of a session. Read from configuration so it can change without a
 * rebuild.
 */
export const SESSION_TTL = env.JWT_EXPIRES_IN;

let cachedKey: Uint8Array | null = null;
function key(): Uint8Array {
  cachedKey ??= new TextEncoder().encode(env.JWT_SECRET);
  return cachedKey;
}

function isRoleName(value: unknown): value is RoleName {
  return value === 'customer' || value === 'admin';
}

/** Sign a session token for a user. */
export async function signSession(claims: SessionClaims): Promise<string> {
  return new SignJWT({ role: claims.role, email: claims.email })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(SESSION_TTL)
    .sign(key());
}

/**
 * Verify a session token and return its claims.
 *
 * Returns undefined for anything untrustworthy: absent, malformed, expired,
 * wrong signature, or an unrecognised role. Callers must not distinguish those
 * cases in any way observable to the client.
 *
 * `algorithms: ['HS256']` is pinned deliberately. Without it a caller can
 * present an `alg: none` token or one signed with a different HMAC algorithm
 * and have it accepted.
 */
export async function verifySession(
  token: string | undefined,
): Promise<SessionClaims | undefined> {
  if (!token) return undefined;
  try {
    const { payload } = await jwtVerify(token, key(), {
      algorithms: ['HS256'],
    });
    if (typeof payload.sub !== 'string') return undefined;
    if (!isRoleName(payload.role)) return undefined;
    return {
      sub: payload.sub,
      role: payload.role,
      email: typeof payload.email === 'string' ? payload.email : '',
      /** Issued-at seconds, used for session revocation. */
      issuedAt: typeof payload.iat === 'number' ? payload.iat : undefined,
    };
  } catch {
    return undefined;
  }
}

export type { JWTPayload };
