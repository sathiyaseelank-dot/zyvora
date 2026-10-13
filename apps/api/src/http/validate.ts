import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { z, ZodError, type ZodTypeAny } from 'zod';

import { AppError } from './errors.js';

/**
 * Zod request validation middleware — Story ZYV-34.
 *
 * Rejects malformed input before it reaches business logic. Validates body,
 * params and query in one declaration, and converts Zod issues into
 * field-level messages so the frontend can highlight the offending input
 * rather than showing a generic failure.
 */

export interface ValidationSchemas {
  body?: ZodTypeAny;
  params?: ZodTypeAny;
  query?: ZodTypeAny;
}

/**
 * Flatten Zod issues into `{ "field.path": "message" }`.
 *
 * `flatten().fieldErrors` only covers the top level; a nested object like
 * `address.pinCode` arrives as `address` with an array of strings, which is
 * useless for form highlighting. This walks the tree instead.
 */
export function toFieldErrors(error: ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.length ? issue.path.join('.') : '_root';
    (out[key] ??= []).push(issue.message);
  }
  return out;
}

/**
 * Validate the request and replace it with the parsed (coerced, defaulted)
 * value.
 *
 * This matters beyond tidiness: `?page=abc` becomes the number NaN otherwise,
 * and a schema with `.default()` only applies when the parsed result is used.
 */
export function validate(schemas: ValidationSchemas): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const fieldErrors: Record<string, string[]> = {};

    for (const source of ['body', 'params', 'query'] as const) {
      const schema = schemas[source];
      if (!schema) continue;

      const result = schema.safeParse(req[source]);
      if (!result.success) {
        for (const [field, messages] of Object.entries(
          toFieldErrors(result.error),
        )) {
          // Prefix so `page` and `query.page` stay distinguishable.
          fieldErrors[`${source}.${field}`] = messages;
        }
        continue;
      }

      // Express 5 exposes req.query via a getter, so it cannot be assigned.
      // Route handlers read these through `req.valid` instead.
      req.valid ??= {};
      req.valid[source] = result.data;
    }

    if (Object.keys(fieldErrors).length > 0) {
      next(
        new AppError('VALIDATION_ERROR', 'Request validation failed', {
          fieldErrors,
        }),
      );
      return;
    }

    next();
  };
}

// Augment Express so `req.valid` is typed. See ./types.ts.
declare module 'express-serve-static-core' {
  interface Request {
    valid?: {
      body?: unknown;
      params?: unknown;
      query?: unknown;
    };
  }
}

/**
 * Typed accessor for a validated value.
 *
 * `validate({ query: schema })` guarantees `req.valid.query` is the parsed
 * output, so handlers never re-read the raw (unvalidated) input.
 */
export function valid<T>(req: Request, source: 'body' | 'params' | 'query'): T {
  const value = req.valid?.[source];
  if (value === undefined) {
    // Programming error: the route called valid() without the matching
    // validate() middleware. Failing loudly beats silently reading raw input.
    throw new AppError(
      'INTERNAL_ERROR',
      `No validated ${source} on this request — did you register validate({ ${source} })?`,
    );
  }
  return value as T;
}

// Re-exported so routes can declare schemas without a second import.
export { z };
