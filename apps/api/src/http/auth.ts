import type { Request, RequestHandler } from 'express';
import { jwtVerify, type JWTPayload } from 'jose';

import { env } from '../config/env.js';
import { db } from '../db/client.js';
import { AppError } from './errors.js';

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

/** Name of the session cookie. Matches the E6 auth routes that will set it. */
export const SESSION_COOKIE = 'zyvora_session';

export type RoleName = 'customer' | 'admin';

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

/** Lazily built so importing this module does not throw on a bad secret. */
let cachedKey: Uint8Array | null = null;
function secretKey(): Uint8Array {
  cachedKey ??= new TextEncoder().encode(env.JWT_SECRET);
  return cachedKey;
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

function isRoleName(value: unknown): value is RoleName {
  return value === 'customer' || value === 'admin';
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

  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(token, secretKey(), {
      // Pin the algorithm. Without this, an attacker can present an unsigned
      // or differently-signed token and have it accepted.
      algorithms: ['HS256'],
    }));
  } catch {
    // Expired, tampered, or malformed — all indistinguishable to the caller
    // and all mean "no session".
    return undefined;
  }

  if (typeof payload.sub !== 'string') return undefined;
  if (!isRoleName(payload.role)) return undefined;

  const row = await db
    .selectFrom('users')
    .innerJoin('roles', 'roles.id', 'users.role_id')
    .select([
      'users.id',
      'users.email',
      'users.full_name',
      'users.mobile',
      'roles.name as role',
    ])
    .where('users.id', '=', payload.sub)
    .executeTakeFirst();

  if (!row || !isRoleName(row.role)) return undefined;

  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    mobile: row.mobile,
    role: row.role,
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
