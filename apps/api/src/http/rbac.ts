import type { NextFunction, Request, RequestHandler, Response } from 'express';

import { AppError } from './errors.js';
import { type RoleName } from './auth.js';

/**
 * Role-based authorization — Story ZYV-35.
 *
 * Customer vs admin is enforced here, on the backend, on every request. The
 * frontend hiding a button is a courtesy to the user, never a control
 * (requirements.md §5J, E3-S5).
 *
 * `requireRole` always assumes `requireAuth` has already run; without it there
 * is no `req.user` to check and the request is rejected rather than allowed.
 */

/** Require the signed-in user to hold one of `roles`. */
export function requireRole(...roles: RoleName[]): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const user = req.user;

    // No requireAuth upstream — a wiring bug, not a client error.
    if (!user) {
      next(
        new AppError(
          'AUTH_REQUIRED',
          'You must be signed in to perform this action',
        ),
      );
      return;
    }

    if (!roles.includes(user.role)) {
      next(
        new AppError(
          'FORBIDDEN',
          'You do not have permission to perform this action',
        ),
      );
      return;
    }

    next();
  };
}

/** Require the admin role. */
export const requireAdmin: RequestHandler = requireRole('admin');

/**
 * Assert the user owns the resource.
 *
 * Horizontal authorisation (E13-S13): a customer must not reach another
 * customer's orders or addresses. Ownership is checked against the row that was
 * actually loaded, never against an id the client supplied.
 */
export function requireOwnership(
  ownerId: string | null | undefined,
  userId: string | undefined,
): void {
  if (!userId) {
    throw new AppError(
      'AUTH_REQUIRED',
      'You must be signed in to perform this action',
    );
  }

  // An unowned row is not accessible to a signed-in customer either.
  if (ownerId !== userId) {
    // 404 rather than 403: a 403 confirms the resource exists, which leaks
    // another customer's data by inference. E9-S1 permits either, but 404 is
    // the safer default and still satisfies the acceptance criterion.
    throw new AppError('NOT_FOUND', 'Resource not found');
  }
}
