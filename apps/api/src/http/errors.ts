// Typed application errors — Story ZYV-39 (Central error handling)
//
// Every failure the API surfaces deliberately is an AppError carrying a
// machine-readable code, an HTTP status, and optional field-level details.
// Anything that is NOT an AppError is treated as an unexpected fault: it is
// logged with a full stack and reported to the caller as a generic
// INTERNAL_ERROR so internals never leak.

export const ERROR_CODES = {
  VALIDATION_ERROR: 400,
  BAD_REQUEST: 400,
  AUTH_REQUIRED: 401,
  INVALID_CREDENTIALS: 401,
  SESSION_EXPIRED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  CONFLICT: 409,
  UNPROCESSABLE: 422,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

export interface ErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    details?: unknown;
  };
}

/**
 * An error that is safe to show the caller.
 *
 * `message` is authored deliberately and must never contain secrets, SQL, or
 * stack frames. Anything that does is a bug in the throw site, not here.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = ERROR_CODES[code];
    this.details = details;
    Error.captureStackTrace?.(this, AppError);
  }

  toBody(): ErrorBody {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details === undefined ? {} : { details: this.details }),
      },
    };
  }
}

export const badRequest = (m: string, d?: unknown) =>
  new AppError('BAD_REQUEST', m, d);
export const unauthorized = (m = 'Authentication required', d?: unknown) =>
  new AppError('AUTH_REQUIRED', m, d);
export const forbidden = (m = 'You do not have access to this resource') =>
  new AppError('FORBIDDEN', m);
export const notFound = (m = 'Resource not found') =>
  new AppError('NOT_FOUND', m);
export const conflict = (m: string, d?: unknown) =>
  new AppError('CONFLICT', m, d);
export const validationError = (m: string, d?: unknown) =>
  new AppError('VALIDATION_ERROR', m, d);

/**
 * True when the value is an AppError.
 *
 * Used by the central handler to decide whether the failure is expected
 * (report it verbatim) or a fault (mask it).
 */
export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}
