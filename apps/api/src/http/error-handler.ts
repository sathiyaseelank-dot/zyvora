import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ZodError } from 'zod';

import { env } from '../config/env.js';
import { logger } from './logger.js';
import { AppError, isAppError } from './errors.js';

/**
 * Single error handler for the whole API — Story ZYV-39.
 *
 * Registered last so it catches anything thrown by middleware or a route,
 * including async rejections (see `asyncHandler` in ./async-handler.ts).
 *
 * Two classes of failure:
 *   - Expected  (AppError / ZodError) → reported verbatim, status from the type.
 *   - Unexpected (anything else)      → logged with a full stack, reported as a
 *                                      generic INTERNAL_ERROR. Stack traces and
 *                                      internal messages are never sent to the
 *                                      client in production.
 */
export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  // A response already committed cannot be rewritten; hand back to Express so
  // it can destroy the socket rather than throwing ERR_HTTP_HEADERS_SENT.
  if (res.headersSent) {
    next(err);
    return;
  }

  if (err instanceof ZodError) {
    // Reached when a handler validates directly instead of via `validate`.
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: err.flatten(),
      },
    });
    return;
  }

  if (isAppError(err)) {
    // 5xx from an AppError is still a bug, so log it with the stack.
    if (err.status >= 500) {
      logger.error('unhandled application error', {
        code: err.code,
        method: req.method,
        path: req.path,
        stack: err.stack,
      });

      // A 5xx AppError message is still internal text — it can name tables,
      // upstream hosts or queries. Mask it in production exactly like an
      // unexpected fault, and drop `details` for the same reason. The `code`
      // survives so a client can still branch.
      res.status(err.status).json({
        error: {
          code: err.code,
          message: 'An unexpected error occurred',
        },
      });
      return;
    }

    // 4xx is deliberately user-facing: validation messages and details are the
    // contract the frontend renders.
    res.status(err.status).json(err.toBody());
    return;
  }

  // Unexpected fault.
  const stack = err instanceof Error ? err.stack : String(err);
  logger.error('unhandled error', {
    method: req.method,
    path: req.path,
    stack,
  });

  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      // In development the message helps; in production it is a disclosure
      // risk. An empty message (common for connection-level faults such as
      // ECONNREFUSED) is worse than useless, so fall back to the generic text.
      message:
        env.NODE_ENV === 'production'
          ? 'An unexpected error occurred'
          : err instanceof Error && err.message
            ? err.message
            : 'An unexpected error occurred',
    },
  });
}

/** 404 for any route that did not match. Registered before the error handler. */
export function notFoundHandler(): RequestHandler {
  return (req, _res, next) => {
    next(
      new AppError(
        'NOT_FOUND',
        `No route matches ${req.method} ${req.originalUrl}`,
      ),
    );
  };
}
