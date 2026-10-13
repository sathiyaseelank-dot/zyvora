// Structured request logging — Story ZYV-31
//
// Emits one JSON object per line so the output is machine-parseable by any log
// shipper. Every value is passed through `redact` before it is written, so a
// password or token cannot reach the log even if a caller passes it in by
// accident. E3-S7 acceptance criterion: "No secrets or passwords logged".

import { env } from '../config/env.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

/**
 * Keys whose values are replaced wholesale, at any depth.
 *
 * Matching is case-insensitive and substring-based, so `password_hash`,
 * `newPassword` and `STRIPE_SECRET_KEY` are all caught.
 */
const SENSITIVE_KEY_FRAGMENTS = [
  'password',
  'passwd',
  'secret',
  'token',
  'authorization',
  'cookie',
  'session',
  'apikey',
  'api_key',
  'private',
  'credential',
  'otp',
  'cvv',
  'cardnumber',
  'pan',
];

export const REDACTED = '[REDACTED]';

/** True when a key name should never have its value logged. */
export function isSensitiveKey(key: string): boolean {
  const k = key.toLowerCase();
  return SENSITIVE_KEY_FRAGMENTS.some((frag) => k.includes(frag));
}

/**
 * Deep-clone `value`, replacing sensitive fields with [REDACTED].
 *
 * Recurses through plain objects and arrays. Cycles are broken with a marker
 * rather than throwing — a logging helper must never take down the request it
 * is describing.
 */
export function redact(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null || typeof value !== 'object') return value;

  if (seen.has(value as object)) return '[Circular]';
  seen.add(value as object);

  if (Array.isArray(value)) {
    return value.map((item) => redact(item, seen));
  }

  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    out[key] = isSensitiveKey(key) ? REDACTED : redact(val, seen);
  }
  return out;
}

function write(
  level: LogLevel,
  message: string,
  context?: Record<string, unknown>,
): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[env.LOG_LEVEL]) return;

  const record = {
    level,
    time: new Date().toISOString(),
    msg: message,
    ...(context ? (redact(context) as Record<string, unknown>) : {}),
  };

  const line = JSON.stringify(record);
  if (level === 'error' || level === 'warn') process.stderr.write(`${line}\n`);
  else process.stdout.write(`${line}\n`);
}

export const logger = {
  debug: (m: string, c?: Record<string, unknown>) => write('debug', m, c),
  info: (m: string, c?: Record<string, unknown>) => write('info', m, c),
  warn: (m: string, c?: Record<string, unknown>) => write('warn', m, c),
  error: (m: string, c?: Record<string, unknown>) => write('error', m, c),
};

/**
 * Request logging middleware — one structured record per completed request.
 *
 * `next()` is called before writing so the handler runs first and `next(error)`
 * from a route is observed as a real error rather than being overwritten by a
 * 200-level access line.
 */
export function requestLogger() {
  return (
    req: import('express').Request,
    res: import('express').Response,
    next: import('express').NextFunction,
  ): void => {
    const start = process.hrtime.bigint();

    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
      logger.info('request', {
        method: req.method,
        path: req.originalUrl,
        status: res.statusCode,
        durationMs: Math.round(durationMs * 100) / 100,
        requestId: res.locals.requestId,
        // Never the Authorization header or cookie jar — both are redacted by
        // key name, and we deliberately do not pass them at all.
        userAgent: req.get('user-agent'),
        ip: req.ip,
      });
    });

    next();
  };
}
