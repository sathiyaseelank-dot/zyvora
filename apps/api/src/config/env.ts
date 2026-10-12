// Environment configuration with validation
// Story: ZYV-16 (Environment variables and .env.example)

interface EnvConfig {
  PORT: number;
  NODE_ENV: 'development' | 'production' | 'test';
  LOG_LEVEL: 'debug' | 'info' | 'warn' | 'error';
  DATABASE_URL: string;
  JWT_SECRET: string;
  COOKIE_SECRET: string;
  FRONTEND_URL: string;
  CORS_ORIGINS: string[];
}

function getEnv(key: string, defaultValue?: string): string {
  const value = process.env[key];
  if (value === undefined) {
    if (defaultValue !== undefined) return defaultValue;
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function getEnvNumber(key: string, defaultValue?: number): number {
  const value = process.env[key];
  if (value === undefined) {
    if (defaultValue !== undefined) return defaultValue;
    throw new Error(`Missing required environment variable: ${key}`);
  }
  const parsed = Number(value);
  if (isNaN(parsed)) {
    throw new Error(`Environment variable ${key} must be a number`);
  }
  return parsed;
}

export const env: EnvConfig = {
  PORT: getEnvNumber('PORT', 4000),
  NODE_ENV: getEnv('NODE_ENV', 'development') as EnvConfig['NODE_ENV'],
  LOG_LEVEL: getEnv('LOG_LEVEL', 'info') as EnvConfig['LOG_LEVEL'],
  DATABASE_URL: getEnv(
    'DATABASE_URL',
    'postgresql://postgres:postgres@localhost:5432/zyvora',
  ),
  JWT_SECRET: getEnv(
    'JWT_SECRET',
    'dev-secret-change-in-production-min-32-chars',
  ),
  COOKIE_SECRET: getEnv(
    'COOKIE_SECRET',
    'dev-cookie-secret-change-in-production-min-32-chars',
  ),
  FRONTEND_URL: getEnv('FRONTEND_URL', 'http://localhost:5173'),
  // Vite binds 127.0.0.1 by default, so both spellings must be allowed or the
  // browser blocks the storefront's catalog requests on one of them.
  CORS_ORIGINS: getEnv(
    'CORS_ORIGINS',
    'http://localhost:5173,http://127.0.0.1:5173',
  ).split(','),
};

// Validate config at startup
if (env.NODE_ENV === 'production') {
  if (env.JWT_SECRET === 'dev-secret-change-in-production-min-32-chars') {
    throw new Error('JWT_SECRET must be set in production');
  }
  if (
    env.COOKIE_SECRET === 'dev-cookie-secret-change-in-production-min-32-chars'
  ) {
    throw new Error('COOKIE_SECRET must be set in production');
  }
}
