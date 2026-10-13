// Environment configuration with validation — Stories ZYV-16, ZYV-28.
//
// Imported for its side effect at process start: every problem is collected and
// reported at once, so a misconfigured deploy fails immediately with all the
// reasons listed rather than one per restart.
//
// ZYV-28 acceptance criterion: "Missing required env fails fast with clear
// message" and "Config validated at boot".

interface EnvConfig {
  PORT: number;
  NODE_ENV: 'development' | 'production' | 'test';
  LOG_LEVEL: 'debug' | 'info' | 'warn' | 'error';
  DATABASE_URL: string;
  JWT_SECRET: string;
  JWT_EXPIRES_IN: string;
  COOKIE_SECRET: string;
  FRONTEND_URL: string;
  CORS_ORIGINS: string[];
}

const DEFAULTS = {
  PORT: 4000,
  NODE_ENV: 'development',
  LOG_LEVEL: 'info',
  DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/zyvora',
  JWT_SECRET: 'dev-secret-change-in-production-min-32-chars',
  JWT_EXPIRES_IN: '7d',
  COOKIE_SECRET: 'dev-cookie-secret-change-in-production-min-32-chars',
  FRONTEND_URL: 'http://localhost:5173',
  CORS_ORIGINS: 'http://localhost:5173,http://127.0.0.1:5173',
} as const;

const errors: string[] = [];

function raw(key: string): string | undefined {
  const v = process.env[key];
  if (v === undefined) return undefined;
  const trimmed = v.trim();
  return trimmed.length ? trimmed : undefined;
}

function requireString(key: string, fallback: string): string {
  const value = raw(key);
  if (value === undefined) return fallback;
  return value;
}

function requireNumber(key: string, fallback: number): number {
  const value = raw(key);
  if (value === undefined) return fallback;

  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    errors.push(`${key} must be an integer (received "${value}")`);
    return fallback;
  }
  if (parsed < 1 || parsed > 65_535) {
    errors.push(
      `${key} must be a valid port between 1 and 65535 (received ${parsed})`,
    );
    return fallback;
  }
  return parsed;
}

function requireOneOf<T extends string>(
  key: string,
  allowed: readonly T[],
  fallback: T,
): T {
  const value = raw(key);
  if (value === undefined) return fallback;
  if (!allowed.includes(value as T)) {
    errors.push(
      `${key} must be one of: ${allowed.join(', ')} (received "${value}")`,
    );
    return fallback;
  }
  return value as T;
}

export const env: EnvConfig = {
  PORT: requireNumber('PORT', DEFAULTS.PORT),
  NODE_ENV: requireOneOf(
    'NODE_ENV',
    ['development', 'production', 'test'] as const,
    DEFAULTS.NODE_ENV,
  ),
  LOG_LEVEL: requireOneOf(
    'LOG_LEVEL',
    ['debug', 'info', 'warn', 'error'] as const,
    DEFAULTS.LOG_LEVEL,
  ),
  DATABASE_URL: requireString('DATABASE_URL', DEFAULTS.DATABASE_URL),
  JWT_SECRET: requireString('JWT_SECRET', DEFAULTS.JWT_SECRET),
  JWT_EXPIRES_IN: requireString('JWT_EXPIRES_IN', DEFAULTS.JWT_EXPIRES_IN),
  COOKIE_SECRET: requireString('COOKIE_SECRET', DEFAULTS.COOKIE_SECRET),
  FRONTEND_URL: requireString('FRONTEND_URL', DEFAULTS.FRONTEND_URL),
  // Vite binds 127.0.0.1 by default, so both spellings must be allowed or the
  // browser blocks the storefront's catalog requests on one of them.
  CORS_ORIGINS: requireString('CORS_ORIGINS', DEFAULTS.CORS_ORIGINS)
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),
};

// --- Boot-time validation -------------------------------------------------

if (!/^postgres(ql)?:\/\//.test(env.DATABASE_URL)) {
  errors.push('DATABASE_URL must be a postgresql:// connection string');
}

if (env.CORS_ORIGINS.length === 0) {
  errors.push('CORS_ORIGINS must list at least one allowed origin');
}

for (const origin of env.CORS_ORIGINS) {
  if (!/^https?:\/\//.test(origin)) {
    errors.push(
      `CORS_ORIGINS entry "${origin}" must start with http:// or https://`,
    );
  }
}

if (env.NODE_ENV === 'production') {
  // Shipping the dev defaults to production would let anyone mint a valid
  // session cookie, so this is a hard stop rather than a warning.
  if (env.JWT_SECRET === DEFAULTS.JWT_SECRET) {
    errors.push('JWT_SECRET must be set to a unique value in production');
  }
  if (env.COOKIE_SECRET === DEFAULTS.COOKIE_SECRET) {
    errors.push('COOKIE_SECRET must be set to a unique value in production');
  }
  for (const key of ['JWT_SECRET', 'COOKIE_SECRET'] as const) {
    if (env[key].length < 32) {
      errors.push(`${key} must be at least 32 characters in production`);
    }
  }
}

if (errors.length > 0) {
  // Thrown during module evaluation, so the process dies before it can bind a
  // port or serve a request with bad configuration.
  throw new Error(
    `Invalid environment configuration:\n${errors.map((e) => `  - ${e}`).join('\n')}`,
  );
}
