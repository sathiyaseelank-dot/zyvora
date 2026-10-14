import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { spawnSync } from 'node:child_process';
import * as path from 'node:path';

/**
 * Boot-time configuration validation — ZYV-28.
 *
 * A mutation sweep found that disabling the production-secret check and the
 * DATABASE_URL format check each failed zero tests, so "missing required env
 * fails fast" was asserted nowhere.
 *
 * `env.ts` throws during module evaluation, so each case runs in a child
 * process: once this module is loaded the configuration is fixed, and a test
 * that mutated the environment in-process could never reach a different
 * validation branch.
 */

const ENV_TS = path.join(
  path.dirname(new URL(import.meta.url).pathname),
  '..',
  'src',
  'config',
  'env.ts',
);

const TAG = '__ENV_RESULT__';

interface Outcome {
  threw: boolean;
  message: string;
}

function loadEnv(overrides: Record<string, string | undefined>): Outcome {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined) env[k] = v;
  }
  // Remove any inherited values so each case starts from the built-in defaults.
  for (const k of [
    'NODE_ENV',
    'PORT',
    'LOG_LEVEL',
    'DATABASE_URL',
    'JWT_SECRET',
    'COOKIE_SECRET',
    'CORS_ORIGINS',
    'TRUST_PROXY',
  ]) {
    delete env[k];
  }
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete env[k];
    else env[k] = v;
  }

  const res = spawnSync(
    process.execPath,
    [
      '--import',
      'tsx',
      '--eval',
      `
      try {
        const m = await import(${JSON.stringify(ENV_TS)});
        process.stdout.write('${TAG}' + JSON.stringify({ threw: false, message: '' }));
      } catch (e) {
        process.stdout.write('${TAG}' + JSON.stringify({ threw: true, message: String(e && e.message || e) }));
      }
      `,
    ],
    { encoding: 'utf8', env },
  );

  assert.equal(res.status, 0, `child failed: ${res.stderr}`);
  const line = res.stdout.split('\n').find((l) => l.startsWith(TAG));
  assert.ok(
    line,
    `no tagged result. stdout:\n${res.stdout}\nstderr:\n${res.stderr}`,
  );
  return JSON.parse(line.slice(TAG.length)) as Outcome;
}

const GOOD_SECRETS = {
  JWT_SECRET: 'a-production-secret-of-at-least-32-characters',
  COOKIE_SECRET: 'another-production-secret-32-characters',
};

describe('boot config validation', () => {
  it('loads with no configuration at all (development defaults)', () => {
    const out = loadEnv({});
    assert.equal(out.threw, false, out.message);
  });

  it('refuses to start in production on the development secrets', () => {
    const out = loadEnv({ NODE_ENV: 'production' });
    assert.equal(out.threw, true, 'production booted with default secrets');
    assert.match(
      out.message,
      /JWT_SECRET must be set to a unique value in production/,
    );
    assert.match(
      out.message,
      /COOKIE_SECRET must be set to a unique value in production/,
    );
  });

  it('refuses production secrets that are too short', () => {
    const out = loadEnv({
      NODE_ENV: 'production',
      JWT_SECRET: 'short',
      COOKIE_SECRET: 'also-short',
    });
    assert.equal(out.threw, true);
    assert.match(out.message, /at least 32 characters/);
  });

  it('accepts a properly configured production environment', () => {
    const out = loadEnv({ NODE_ENV: 'production', ...GOOD_SECRETS });
    assert.equal(out.threw, false, out.message);
  });

  it('rejects a malformed DATABASE_URL', () => {
    const out = loadEnv({ DATABASE_URL: 'mysql://localhost/zyvora' });
    assert.equal(out.threw, true, 'a non-postgres DATABASE_URL was accepted');
    assert.match(out.message, /DATABASE_URL must be a postgresql/);
  });

  it('rejects a non-integer PORT', () => {
    const out = loadEnv({ PORT: 'abc' });
    assert.equal(out.threw, true);
    assert.match(out.message, /PORT must be an integer/);
  });

  it('rejects an out-of-range PORT', () => {
    const out = loadEnv({ PORT: '70000' });
    assert.equal(out.threw, true);
    assert.match(out.message, /valid port/);
  });

  it('rejects an unknown NODE_ENV', () => {
    const out = loadEnv({ NODE_ENV: 'staging' });
    assert.equal(out.threw, true);
    assert.match(out.message, /NODE_ENV must be one of/);
  });

  it('rejects an unknown LOG_LEVEL', () => {
    const out = loadEnv({ LOG_LEVEL: 'verbose' });
    assert.equal(out.threw, true);
    assert.match(out.message, /LOG_LEVEL must be one of/);
  });

  it('rejects a CORS origin with no scheme', () => {
    const out = loadEnv({ CORS_ORIGINS: 'localhost:5173' });
    assert.equal(out.threw, true);
    assert.match(out.message, /must start with http/);
  });

  it('rejects an unparseable TRUST_PROXY rather than silently trusting proxies', () => {
    const out = loadEnv({ TRUST_PROXY: 'bogus' });
    assert.equal(out.threw, true);
    assert.match(
      out.message,
      /TRUST_PROXY must be false or a positive integer/,
    );
  });

  it('defaults TRUST_PROXY to false so X-Forwarded-For is not trusted', () => {
    // The value itself is asserted by the rate-limit tests; this pins the
    // default, because flipping it to 1 re-opens the spoofing bypass.
    const res = spawnSync(
      process.execPath,
      [
        '--import',
        'tsx',
        '--eval',
        `const m = await import(${JSON.stringify(ENV_TS)});
         process.stdout.write('${TAG}' + JSON.stringify(m.env.TRUST_PROXY));`,
      ],
      {
        encoding: 'utf8',
        env: Object.fromEntries(
          Object.entries(process.env).filter(([k]) => k !== 'TRUST_PROXY'),
        ),
      },
    );
    const line = res.stdout.split('\n').find((l) => l.startsWith(TAG));
    assert.ok(line, `no result. stdout:${res.stdout} stderr:${res.stderr}`);
    assert.equal(line.slice(TAG.length), 'false');
  });

  it('reports every problem at once instead of one per restart', () => {
    const out = loadEnv({
      NODE_ENV: 'production',
      PORT: 'abc',
      DATABASE_URL: 'nope',
    });
    assert.equal(out.threw, true);
    // All three must appear in a single failure.
    assert.match(out.message, /PORT must be an integer/);
    assert.match(out.message, /DATABASE_URL must be a postgresql/);
    assert.match(out.message, /JWT_SECRET must be set/);
  });
});
