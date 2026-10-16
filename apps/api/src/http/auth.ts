import type { Request, RequestHandler } from 'express';

import { db } from '../db/client.js';
import { AppError } from './errors.js';
import { SESSION_COOKIE, type RoleName, verifySession } from '../auth/jwt.js';

/**
 * Authentication middleware — Story ZYV-32.
 *
 * Resolves the current user from the `zyvora_session` HTTP-only cookie and
 * attaches it to the request. There is no server-side session table, so the
 * cookie carries a signed JWT (requirements.md §3 permits JWT in HTTP-only
 * cookies).
 *
 * Enforcement is at the API boundary: a client-side gate is a UX convenience
 * and is bypassable by anyone calling the API directly.
 */

// Re-exported so existing importers keep working; the definitions live in
// auth/jwt.ts so there is exactly one implementation of token handling.
export { SESSION_COOKIE };
export type { RoleName };

export interface AuthenticatedUser {
  id: string;
  email: string;
  fullName: string | null;
  mobile: string | null;
  role: RoleName;
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthenticatedUser;
  }
}

/**
 * Extract the raw JWT from the request.
 *
 * Reads the cookie only. Authorization headers are deliberately NOT accepted:
 * accepting a bearer token here would make it easy for a future change to
 * start trusting a token the browser never should be sending, and ADR-001
 * fixes cookie transport.
 */
function readSessionToken(req: Request): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;

  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const name = part.slice(0, idx).trim();
    if (name !== SESSION_COOKIE) continue;
    try {
      return decodeURIComponent(part.slice(idx + 1).trim());
    } catch {
      // Malformed percent-encoding — treat as no session rather than 500.
      return undefined;
    }
  }
  return undefined;
}

/**
 * Verify the JWT and load the user.
 *
 * The user row is re-read on every request rather than trusted from the token
 * body, so a role change or a deleted account takes effect immediately instead
 * of lingering until the token expires.
 */
export async function resolveUser(
  req: Request,
): Promise<AuthenticatedUser | undefined> {
  const token = readSessionToken(req);
  if (!token) return undefined;

  // Verification, algorithm pinning and the role allow-list all live in
  // auth/jwt.ts. This function used to carry a second copy of all of it.
  const claims = await verifySession(token);
  if (!claims) return undefined;

  const payload = {
    sub: claims.sub,
    iat: claims.issuedAt,
    iatMs: claims.issuedAtMs,
  };

  const row = await db
    .selectFrom('users')
    .innerJoin('roles', 'roles.id', 'users.role_id')
    .select([
      'users.id',
      'users.email',
      'users.full_name',
      'users.mobile',
      'users.session_invalid_before',
      'roles.name as role',
    ])
    .where('users.id', '=', payload.sub)
    .executeTakeFirst();

  if (!row || (row.role !== 'customer' && row.role !== 'admin'))
    return undefined;

  // Session revocation. The JWT is stateless, so a password change would
  // otherwise leave every already-issued cookie valid for its full lifetime.
  // Compared in MILLISECONDS against the signed `iatMs` claim, so a token is
  // revoked if and only if it was genuinely issued before the reset.
  //
  // Both earlier attempts were wrong in opposite directions:
  //   `iat <= ms/1000`   killed a fresh login made in the same second as the
  //                      reset, locking the user out of the account they had
  //                      just reset (reproduced: reset at .749s, then login,
  //                      then /me returned 401).
  //   `iat < floor(ms/1000)` saved that login, but let a token minted
  //                      microseconds BEFORE the reset survive.
  // The millisecond claim removes the tie rather than picking a side.
  if (row.session_invalid_before) {
    const revokedAtMs = row.session_invalid_before.getTime();
    const issuedAtMs =
      typeof payload.iatMs === 'number' ? payload.iatMs : undefined;
    // A token with no usable issue time cannot be shown to predate the reset,
    // so it is admitted; `exp` still bounds it.
    if (issuedAtMs !== undefined && issuedAtMs < revokedAtMs) return undefined;
  }

  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    mobile: row.mobile,
    role: row.role as RoleName,
  };
}

/**
 * Attach the user when a valid session exists; never rejects.
 *
 * Use on endpoints that are readable by anyone but behave differently for a
 * signed-in customer (e.g. `GET /api/cart`).
 */
export function optionalAuth(): RequestHandler {
  return (req, _res, next) => {
    resolveUser(req)
      .then((user) => {
        if (user) req.user = user;
        next();
      })
      .catch(next);
  };
}

/** Reject with 401 when there is no valid session. */
export function requireAuth(): RequestHandler {
  return (req, _res, next) => {
    resolveUser(req)
      .then((user) => {
        if (!user) {
          next(
            new AppError(
              'AUTH_REQUIRED',
              'You must be signed in to perform this action',
            ),
          );
          return;
        }
        req.user = user;
        next();
      })
      .catch(next);
  };
}
