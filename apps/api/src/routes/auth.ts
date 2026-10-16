import { Router, type Request, type Response } from 'express';
import { z } from 'zod';

import { db } from '../db/client.js';
import { asyncHandler } from '../http/async-handler.js';
import { AppError } from '../http/errors.js';
import { validate, valid } from '../http/validate.js';
import { env } from '../config/env.js';
import { optionalAuth, requireAuth, type RoleName } from '../http/auth.js';
import { audit } from '../audit/audit-log.js';
import {
  generateResetToken,
  dummyVerify,
  hashPassword,
  parseResetTokenId,
  resetTokenSecret,
  validatePassword,
  verifyPassword,
} from '../auth/password.js';
import {
  clearSessionCookies,
  issueCsrfCookie,
  issueSessionCookies,
  verifyCsrf,
} from '../auth/session.js';
import { signSession } from '../auth/jwt.js';

/**
 * Authentication endpoints — Epic E6.
 *
 *   ZYV-51  POST /api/auth/register
 *   ZYV-46  POST /api/auth/login
 *   ZYV-48  POST /api/auth/logout
 *   ZYV-53  GET  /api/auth/me
 *   ZYV-50  POST /api/auth/forgot-password
 *   ZYV-50  POST /api/auth/reset-password
 *   ZYV-52  anti-enumeration behaviour throughout
 *   ZYV-56  HTTP-only cookie sessions with CSRF
 *
 * Anti-enumeration (E6-S8) shapes three of these responses deliberately:
 * login, forgot-password, and registration all fail identically for "no such
 * account" and "wrong credentials", so the endpoints cannot be used to discover
 * which emails are registered.
 */

/**
 * Reset tokens issued during this process, for development use only.
 *
 * This exists so a developer without a mailer can complete the flow locally,
 * and it evaporates on restart. It is NOT a store — recovery goes through the
 * emailed link once a mailer exists.
 *
 * Two properties it must hold:
 *
 *  - Bounded. Entries are pruned by expiry on every insert, and the map is
 *    capped, so a long-lived process cannot accumulate one raw credential per
 *    reset request forever. Insertion order is preserved by Map, so the cap
 *    evicts the oldest.
 *  - Never populated in production. Holding a raw reset token in memory — and
 *    returning it in a response — is only ever appropriate behind
 *    DEV_EXPOSE_RESET_TOKEN, which the env validator already refuses at boot
 *    when NODE_ENV=production. Writing to this map is gated on the same flag
 *    so that a misconfigured production process degrades to "the emailed link
 *    is the only route", which is the safe failure.
 */
const devResetTokens = new Map<string, { raw: string; expiresAt: number }>();
export const DEV_RESET_TOKEN_CAP = 100;

export function rememberDevResetToken(
  userId: string,
  raw: string,
  expiresAt: number,
): void {
  const now = Date.now();
  for (const [key, entry] of devResetTokens) {
    if (entry.expiresAt <= now) devResetTokens.delete(key);
  }
  // Each user may already hold an entry; drop the stale one first so the cap
  // counts distinct users rather than history.
  devResetTokens.delete(userId);
  devResetTokens.set(userId, { raw, expiresAt });
  while (devResetTokens.size > DEV_RESET_TOKEN_CAP) {
    const oldest = devResetTokens.keys().next();
    if (oldest.done) break;
    devResetTokens.delete(oldest.value);
  }
}

/**
 * Size of the in-process development token map.
 *
 * Exists so the bound can be asserted directly. The alternative — inferring it
 * from the `password_reset_tokens` table — measures the wrong thing entirely:
 * the database enforces "one live token per user" by deleting the previous
 * row, so the table stays at one while the map is what actually grows. A test
 * written against the table passed with the cap disabled.
 */
export function devResetTokenCount(): number {
  return devResetTokens.size;
}

/**
 * Empty the map. Test-only: without it, the cap tests fill the map and every
 * later assertion about it measures the cap rather than the behaviour under
 * test — the assertions would pass or fail on test ORDER.
 */
export function resetDevResetTokens(): void {
  devResetTokens.clear();
}

export const authRouter: Router = Router();

/**
 * CSRF guard for state-changing endpoints (ZYV-56).
 *
 * Applied to login and register as well as logout: without it, a cross-site
 * page can silently sign a visitor into an attacker-controlled account
 * ("login CSRF"), after which anything they save lands on the attacker's
 * account instead.
 */
const requireCsrf: import('express').RequestHandler = (req, _res, next) => {
  if (!verifyCsrf(req)) {
    next(new AppError('FORBIDDEN', 'Missing or invalid CSRF token'));
    return;
  }
  next();
};

/** Minutes a reset token stays usable. */
const RESET_TTL_MINUTES = 30;

const registerSchema = z
  .object({
    fullName: z.string().trim().min(2).max(255),
    email: z.string().trim().toLowerCase().email().max(255),
    mobile: z
      .string()
      .trim()
      .regex(/^[6-9]\d{9}$/, 'Mobile must be a 10-digit Indian number'),
    password: z.string(),
    confirmPassword: z.string(),
    acceptTerms: z.literal(true, {
      errorMap: () => ({ message: 'You must accept the Terms and Conditions' }),
    }),
  })
  .refine((v) => v.password === v.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

const loginSchema = z.object({
  // Requirements allow signing in with either an email address or a mobile
  // number, so the identifier is one polymorphic field rather than two.
  identifier: z.string().trim().min(3).max(255),
  password: z.string().min(1).max(200),
});

const forgotSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(255),
});

const resetSchema = z.object({
  token: z.string().trim().min(10).max(200),
  password: z.string(),
  confirmPassword: z.string(),
});

/**
 * Postgres unique-violation SQLSTATE.
 */
function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === '23505'
  );
}

/**
 * The single response used for every credential failure.
 *
 * One message, one status, one shape. Distinguishing "unknown account" from
 * "wrong password" turns the login form into an account-enumeration oracle.
 */
function invalidCredentials(res: Response): void {
  res.status(401).json({
    error: {
      code: 'INVALID_CREDENTIALS',
      message: 'Invalid email/mobile or password',
    },
  });
}

/** The single response used by forgot-password, whatever the outcome. */
function forgotAck(res: Response): void {
  res.status(202).json({
    data: {
      message:
        'If an account exists for that address, a password reset link has been sent.',
    },
  });
}

/** Look up a user by email OR mobile, per requirements.md 5F. */
async function findByIdentifier(identifier: string) {
  const normalised = identifier.toLowerCase();
  return db
    .selectFrom('users')
    .innerJoin('roles', 'roles.id', 'users.role_id')
    .select([
      'users.id',
      'users.email',
      'users.password_hash',
      'users.full_name',
      'users.mobile',
      'roles.name as role',
    ])
    .where((eb) =>
      eb.or([
        eb('users.email', '=', normalised),
        eb('users.mobile', '=', identifier),
      ]),
    )
    .executeTakeFirst();
}

/** ZYV-51 — POST /api/auth/register */
authRouter.post(
  '/register',
  requireCsrf,
  validate({ body: registerSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const body = valid<z.infer<typeof registerSchema>>(req, 'body');

    const problem = validatePassword(body.password);
    if (problem) throw new AppError('VALIDATION_ERROR', problem);

    const passwordHash = await hashPassword(body.password);

    const role = await db
      .selectFrom('roles')
      .select('id')
      .where('name', '=', 'customer')
      .executeTakeFirstOrThrow();

    // Duplicate email/mobile must be reported, not silently swallowed — a
    // unique violation here is genuine feedback, not an enumeration risk the
    // caller can act on without already knowing the address.
    const clash = await db
      .selectFrom('users')
      .select('id')
      .where((eb) =>
        eb.or([
          eb('users.email', '=', body.email),
          eb('users.mobile', '=', body.mobile),
        ]),
      )
      .executeTakeFirst();

    if (clash) {
      throw new AppError(
        'CONFLICT',
        'An account already exists with that email address or mobile number',
      );
    }

    // The pre-flight `clash` check above is a TOCTOU window: two simultaneous
    // registrations can both pass it and then collide on the unique index.
    // The database is the real arbiter, so its rejection is caught here and
    // reported as the same 409 the pre-flight check would have produced —
    // rather than surfacing as an unhandled 500.
    let user;
    try {
      user = await db
        .insertInto('users')
        .values({
          email: body.email,
          password_hash: passwordHash,
          full_name: body.fullName,
          mobile: body.mobile,
          role_id: role.id,
        })
        .returning(['id', 'email', 'full_name', 'mobile'])
        .executeTakeFirstOrThrow();
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new AppError(
          'CONFLICT',
          'An account already exists with that email address or mobile number',
        );
      }
      throw err;
    }

    // Self-registration can only ever create a customer. An admin is
    // provisioned, never self-assigned.
    const roleName = 'customer' as RoleName;
    const claims = { sub: user.id, role: roleName, email: user.email };
    const token = await signSession(claims);
    issueSessionCookies(res, claims, token);

    void audit(req, {
      action: 'auth.registered',
      entityType: 'user',
      entityId: user.id,
      // Deliberately no password in any form, hashed or otherwise.
      newValues: { email: user.email, mobile: user.mobile },
    });

    res.status(201).json({
      data: {
        user: {
          id: user.id,
          email: user.email,
          fullName: user.full_name,
          mobile: user.mobile,
          role: roleName,
        },
      },
    });
  }),
);

/** ZYV-46 — POST /api/auth/login */
authRouter.post(
  '/login',
  requireCsrf,
  validate({ body: loginSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { identifier, password } = valid<z.infer<typeof loginSchema>>(
      req,
      'body',
    );

    const user = await findByIdentifier(identifier);

    // Burn equivalent CPU whether or not the account exists, so response time
    // does not reveal which identifiers are registered.
    const ok = await verifyPassword(user?.password_hash ?? null, password);

    if (!user || !ok) {
      if (user) {
        void audit(req, {
          action: 'auth.login_failed',
          entityType: 'user',
          entityId: user.id,
          newValues: { identifier, reason: 'wrong_password' },
        });
      }
      invalidCredentials(res);
      return;
    }

    const role = (user.role === 'admin' ? 'admin' : 'customer') as RoleName;
    const claims = { sub: user.id, role, email: user.email };
    const token = await signSession(claims);
    issueSessionCookies(res, claims, token);

    void audit(req, {
      action: 'auth.login_succeeded',
      entityType: 'user',
      entityId: user.id,
      newValues: { identifier, role },
    });

    res.json({
      data: {
        user: {
          id: user.id,
          email: user.email,
          fullName: user.full_name,
          mobile: user.mobile,
          role,
        },
      },
    });
  }),
);

/**
 * GET /api/auth/csrf — hands out a CSRF token before authentication.
 *
 * Login and register are CSRF-guarded, so an unauthenticated form has no way
 * to obtain a token otherwise. Returns the token in the body *and* sets it as
 * a JS-readable cookie; the client echoes the body value in the header.
 */
authRouter.get('/csrf', (_req: Request, res: Response) => {
  const token = issueCsrfCookie(res);
  res.json({ data: { csrfToken: token } });
});

/** ZYV-53 — GET /api/auth/me */
authRouter.get(
  '/me',
  requireAuth(),
  asyncHandler(async (req: Request, res: Response) => {
    const user = req.user!;
    res.json({
      data: {
        user: {
          id: user.id,
          email: user.email,
          fullName: user.fullName,
          mobile: user.mobile,
          role: user.role,
        },
      },
    });
  }),
);

/** ZYV-48 — POST /api/auth/logout */
authRouter.post(
  '/logout',
  requireCsrf,
  // optionalAuth, not requireAuth: logging out with an expired or already
  // cleared cookie should still succeed. Without it req.user is always
  // undefined and the `auth.logged_out` audit below is unreachable.
  optionalAuth(),
  asyncHandler(async (req: Request, res: Response) => {
    // Recorded before the cookie is cleared, while req.user is still readable.
    if (req.user) {
      void audit(req, {
        action: 'auth.logged_out',
        entityType: 'user',
        entityId: req.user.id,
      });
    }
    clearSessionCookies(res);
    res.status(204).send();
  }),
);

/** ZYV-50 — POST /api/auth/forgot-password */
authRouter.post(
  '/forgot-password',
  requireCsrf,
  validate({ body: forgotSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { email } = valid<z.infer<typeof forgotSchema>>(req, 'body');

    const user = await db
      .selectFrom('users')
      .select(['id'])
      .where('email', '=', email)
      .executeTakeFirst();

    if (user) {
      const { raw, id, secret } = generateResetToken();
      // Only the secret's hash is persisted; the raw token exists solely to be
      // emailed. The id is the row's primary key, which makes redemption a
      // single indexed lookup rather than a scan of every outstanding token.
      const tokenHash = await hashPassword(secret);

      // Invalidate any outstanding token so only the newest link works.
      await db
        .deleteFrom('password_reset_tokens')
        .where('user_id', '=', user.id)
        .execute();

      await db
        .insertInto('password_reset_tokens')
        .values({
          id,
          user_id: user.id,
          token_hash: tokenHash,
          expires_at: new Date(Date.now() + RESET_TTL_MINUTES * 60_000),
          ip_address: req.ip ?? null,
        })
        .execute();

      void audit(req, {
        action: 'auth.password_reset_requested',
        entityType: 'user',
        entityId: user.id,
      });

      // No email provider is configured yet (ZYV-83 is explicit that none is
      // assumed). The token must NOT be logged: hashing it in the database is
      // the entire point, and a debug log line would put the raw credential
      // back in plaintext in whatever ships logs — so a stray
      // LOG_LEVEL=debug would quietly undo the protection.
      //
      // It is instead recorded in-process only, and surfaced to the developer
      // through an explicitly opted-in, development-only response field.
      // Absolute expiry as a Unix-millisecond timestamp, matching how
      // `expires_at` is stored on the row and how the pruner compares. This
      // was a bare duration in seconds-of-TTL, i.e. a number that looked like
      // "expired in 1970", so the dev token was dead the moment it was issued.
      //
      // Gated on the same flag that surfaces it: holding a raw reset token in
      // process memory is only ever appropriate in a development setup that
      // has explicitly asked for the token back. A misconfigured production
      // process degrades to "the emailed link is the only route", which is
      // the safe failure — not "every raw token stays resident in RAM".
      if (env.DEV_EXPOSE_RESET_TOKEN) {
        rememberDevResetToken(
          user.id,
          raw,
          Date.now() + RESET_TTL_MINUTES * 60_000,
        );
      }

      if (env.NODE_ENV === 'production' && env.DEV_EXPOSE_RESET_TOKEN) {
        // Refusing loudly beats honouring a foot-gun in production.
        throw new Error(
          'DEV_EXPOSE_RESET_TOKEN must never be enabled in production: it ' +
            'returns live password-reset tokens in an API response.',
        );
      }
    } else {
      // No account. Burn comparable time before acknowledging, because the
      // account branch pays for an Argon2id hash (~45ms) and two writes while
      // this branch would otherwise return in single-digit milliseconds.
      //
      // Measured before the fix: unknown address 3.7ms, known address 51.6ms —
      // a 14x gap, identical status code and identical body. That is a working
      // account-enumeration oracle and it defeats the point of ZYV-52, which
      // explicitly requires forgot-password not to reveal whether an address
      // is registered.
      await dummyVerify(email);
    }

    // Identical response either way, so this cannot enumerate accounts. The
    // development token is attached only when explicitly opted in, and only
    // for an address that actually has an account.
    if (env.DEV_EXPOSE_RESET_TOKEN && user) {
      const issued = devResetTokens.get(user.id);
      if (issued) {
        res.status(202).json({
          data: {
            message:
              'If an account exists for that address, a password reset link has been sent.',
            // DEVELOPMENT ONLY — present solely because DEV_EXPOSE_RESET_TOKEN
            // is set, which is refused in production at boot.
            devResetToken: issued.raw,
          },
        });
        return;
      }
    }

    forgotAck(res);
  }),
);

/** ZYV-50 — POST /api/auth/reset-password */
authRouter.post(
  '/reset-password',
  requireCsrf,
  validate({ body: resetSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { token, password, confirmPassword } = valid<
      z.infer<typeof resetSchema>
    >(req, 'body');

    if (password !== confirmPassword) {
      throw new AppError('VALIDATION_ERROR', 'Passwords do not match');
    }
    const problem = validatePassword(password);
    if (problem) throw new AppError('VALIDATION_ERROR', problem);

    // The token carries its own row id, so this is one indexed lookup. Scanning
    // every unexpired token with Argon2 instead made each request cost O(rows):
    // 40ms empty, 1444ms at 30 rows, and unbounded as the user base grows.
    const tokenId = parseResetTokenId(token);

    // Exactly one Argon2 verification happens on every path, whatever the
    // token looks like. An earlier version short-circuited on `!candidate`, so
    // a well-formed token whose id was absent skipped Argon2 entirely while a
    // malformed one did not — leaving the two distinguishable, and leaving the
    // "cost one verification" guarantee hollow. `verifyPassword(null, …)` runs
    // the dummy verification, which is how the cost stays uniform.
    const secret = resetTokenSecret(token);

    if (!tokenId) {
      await verifyPassword(null, secret);
      throw new AppError(
        'BAD_REQUEST',
        'This reset link is invalid or has expired',
      );
    }

    const candidate = await db
      .selectFrom('password_reset_tokens')
      .select(['id', 'user_id', 'token_hash', 'expires_at', 'used_at'])
      .where('id', '=', tokenId)
      .where('used_at', 'is', null)
      .executeTakeFirst();

    const hashToCheck = candidate?.token_hash ?? null;
    const secretMatches = await verifyPassword(hashToCheck, secret);

    if (
      !candidate ||
      candidate.expires_at.getTime() < Date.now() ||
      !secretMatches
    ) {
      throw new AppError(
        'BAD_REQUEST',
        'This reset link is invalid or has expired',
      );
    }

    const match = { id: candidate.id, user_id: candidate.user_id };

    const newHash = await hashPassword(password);

    // Claiming the token and writing the new password are ONE unit of work.
    // Run separately, a failure between them burns the link while leaving the
    // password unchanged: the user is told the reset failed, the only copy of
    // their link is spent, and they must start the whole flow again — with any
    // stolen session still valid. In a transaction either both land or neither
    // does.
    //
    // The conditional UPDATE (`used_at IS NULL`) is still what makes
    // concurrent redemptions safe: the second writer matches zero rows and
    // throws, and that throw unwinds only its own transaction.
    const changedAt = new Date();

    await db.transaction().execute(async (trx) => {
      const claimed = await trx
        .updateTable('password_reset_tokens')
        .set({ used_at: changedAt })
        .where('id', '=', match.id)
        .where('used_at', 'is', null)
        .executeTakeFirst();

      if (Number(claimed.numUpdatedRows ?? 0) === 0) {
        throw new AppError(
          'BAD_REQUEST',
          'This reset link has already been used',
        );
      }

      await trx
        .updateTable('users')
        .set({
          password_hash: newHash,
          updated_at: changedAt,
          // Kill every session issued before now. A password change is the
          // standard response to a suspected compromise, and leaving old
          // cookies alive would make it pointless.
          session_invalid_before: changedAt,
        })
        .where('id', '=', match.user_id)
        .execute();
    });

    void audit(req, {
      action: 'auth.password_reset',
      entityType: 'user',
      entityId: match.user_id,
    });

    res.json({
      data: { message: 'Your password has been reset. Please sign in.' },
    });
  }),
);

export { requireCsrf };
