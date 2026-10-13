// Public surface of the HTTP layer — Story E3.
//
// Route modules import from `../http/index.js` so the internals of each
// concern stay free to move without touching every importer.

export {
  AppError,
  ERROR_CODES,
  badRequest,
  conflict,
  forbidden,
  isAppError,
  notFound,
  unauthorized,
  validationError,
  type ErrorBody,
  type ErrorCode,
} from './errors.js';

export { errorHandler, notFoundHandler } from './error-handler.js';
export { asyncHandler } from './async-handler.js';
export { validate, valid, toFieldErrors } from './validate.js';
export {
  optionalAuth,
  requireAuth,
  resolveUser,
  SESSION_COOKIE,
  type AuthenticatedUser,
  type RoleName,
} from './auth.js';
export { requireAdmin, requireOwnership, requireRole } from './rbac.js';
export {
  limiters,
  MemoryStore,
  rateLimit,
  resetRateLimits,
  type RateLimitOptions,
} from './rate-limit.js';
export {
  isSensitiveKey,
  logger,
  redact,
  requestLogger,
  REDACTED,
  type LogLevel,
} from './logger.js';
