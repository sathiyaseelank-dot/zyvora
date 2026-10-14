import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

import { createApp } from '../src/app.js';
import { db } from '../src/db/client.js';
import { resetRateLimits } from '../src/http/rate-limit.js';
import { CSRF_COOKIE, CSRF_HEADER } from '../src/auth/session.js';
import {
  startServer,
  jarFetch,
  CookieJar,
  type TestClient,
} from './helpers.js';

/**
 * Epic E6 — Authentication & Sessions, against the real application.
 *
 *   ZYV-51 register   ZYV-46 login    ZYV-48 logout   ZYV-53 me
 *   ZYV-50 reset flow ZYV-52 anti-enumeration        ZYV-56 cookie + CSRF
 *   ZYV-57 Argon2id
 *
 * Cookies flow through a real jar rather than being hand-threaded, so a test
 * fails if the server ever stops setting the session cookie. Rate limits reset
 * between tests so the 10/15min auth limiter does not turn the remainder of
 * the suite into 429s — a suite that passes for the wrong reason.
 */

const EMAIL = 'e6-customer@example.invalid';
const MOBILE = '9876543210';
const PASSWORD = 'correct horse battery staple';

const SESSION_COOKIE = 'zyvora_session';

let client: TestClient;

const VALID_ACCOUNT = {
  fullName: 'E6 Customer',
  email: EMAIL,
  mobile: MOBILE,
  password: PASSWORD,
  confirmPassword: PASSWORD,
  acceptTerms: true,
};

/** One jar per scenario, so a login in one test cannot leak into another. */
let jar: CookieJar;

async function csrf(): Promise<string> {
  const res = await jarFetch<{ data: { csrfToken: string } }>(
    client,
    jar,
    '/api/auth/csrf',
  );
  assert.equal(res.status, 200, 'could not obtain a CSRF token');
  return res.body.data.csrfToken;
}

interface Opts {
  body?: unknown;
  csrf?: boolean | string;
  method?: string;
}

async function post<T = unknown>(path: string, o: Opts = {}) {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };
  const token = o.csrf === false ? null : o.csrf || (await csrf());
  if (token) headers[CSRF_HEADER] = token;
  return jarFetch<T>(client, jar, path, {
    method: o.method ?? 'POST',
    headers,
    ...(o.body === undefined ? {} : { body: JSON.stringify(o.body) }),
  });
}

async function cleanup(): Promise<void> {
  // By email AND mobile: the unique check spans both, so cleaning only one
  // leaves a row that makes the next registration return 409 for a reason that
  // has nothing to do with the test.
  await db
    .deleteFrom('users')
    .where((eb) => eb.or([eb('email', '=', EMAIL), eb('mobile', '=', MOBILE)]))
    .execute();
  await db
    .deleteFrom('audit_logs')
    .where('user_agent', '=', 'e6-test/1.0')
    .execute();
}

async function register() {
  const res = await post('/api/auth/register', { body: VALID_ACCOUNT });
  assert.equal(res.status, 201, 'registration failed during setup');
  return res;
}

before(async () => {
  try {
    await db.selectFrom('roles').select('id').limit(1).execute();
  } catch {
    throw new Error(
      'PostgreSQL is unreachable; E6 tests exercise real sessions and cannot run without it.',
    );
  }
  client = await startServer(createApp());
});

after(async () => {
  await client?.close();
  await cleanup();
  await db.destroy();
});

beforeEach(async () => {
  resetRateLimits();
  await cleanup();
  jar = new CookieJar();
});

describe('ZYV-51 registration', () => {
  it('creates an account and never returns the hash', async () => {
    const res = await post<{ data: { user: Record<string, unknown> } }>(
      '/api/auth/register',
      { body: VALID_ACCOUNT },
    );

    assert.equal(res.status, 201);
    assert.equal(res.body.data.user.email, EMAIL);
    assert.equal(res.body.data.user.role, 'customer');

    const serialised = JSON.stringify(res.body);
    assert.ok(!serialised.includes('argon2'), 'hash leaked in the response');
    assert.ok(
      !serialised.includes('passwordHash'),
      'hash leaked in the response',
    );
  });

  it('stores an Argon2id hash and never the password', async () => {
    await register();
    const row = await db
      .selectFrom('users')
      .select('password_hash')
      .where('email', '=', EMAIL)
      .executeTakeFirstOrThrow();

    assert.match(row.password_hash, /^\$argon2id\$/);
    assert.ok(!row.password_hash.includes(PASSWORD));
  });

  it('issues an HttpOnly session cookie', async () => {
    const res = await post('/api/auth/register', { body: VALID_ACCOUNT });
    assert.equal(res.status, 201);

    const setCookie = res.headers.getSetCookie?.() ?? [];
    const session = setCookie.find((c) => c.startsWith(`${SESSION_COOKIE}=`));
    assert.ok(session, 'no session cookie issued');
    assert.match(session, /HttpOnly/i, 'session cookie must be HttpOnly');
    assert.match(session, /SameSite/i, 'session cookie must set SameSite');

    // The CSRF cookie is deliberately JS-readable; the session cookie is not.
    const csrfCookie = setCookie.find((c) => c.startsWith(`${CSRF_COOKIE}=`));
    assert.ok(csrfCookie, 'no CSRF cookie issued');
    assert.ok(
      !/HttpOnly/i.test(csrfCookie),
      'CSRF cookie must be readable by JS',
    );
  });

  it('rejects a duplicate email with 409', async () => {
    await register();
    const res = await post('/api/auth/register', {
      body: { ...VALID_ACCOUNT, mobile: '9123456789' },
    });
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'CONFLICT');
  });

  it('rejects a duplicate mobile with 409', async () => {
    await register();
    const res = await post('/api/auth/register', {
      body: { ...VALID_ACCOUNT, email: 'other@example.invalid' },
    });
    assert.equal(res.status, 409);
  });

  it('rejects a weak password', async () => {
    const res = await post('/api/auth/register', {
      body: { ...VALID_ACCOUNT, password: 'short', confirmPassword: 'short' },
    });
    assert.equal(res.status, 400);
    assert.match(res.body.error.message, /at least 12/);
  });

  it('rejects mismatched password confirmation', async () => {
    const res = await post('/api/auth/register', {
      body: { ...VALID_ACCOUNT, confirmPassword: 'a different passphrase' },
    });
    assert.equal(res.status, 400);
    // The message is generic; the actionable text is the field-level error.
    assert.match(
      JSON.stringify(res.body.error.details),
      /do not match/i,
      'confirmPassword field error missing',
    );
  });

  it('requires explicit acceptance of the Terms', async () => {
    const res = await post('/api/auth/register', {
      body: { ...VALID_ACCOUNT, acceptTerms: false },
    });
    assert.equal(res.status, 400);
  });

  it('rejects an invalid mobile number', async () => {
    const res = await post('/api/auth/register', {
      body: { ...VALID_ACCOUNT, mobile: '12345' },
    });
    assert.equal(res.status, 400);
  });

  it('cannot self-assign the admin role', async () => {
    const res = await post<{ data: { user: { role: string } } }>(
      '/api/auth/register',
      { body: { ...VALID_ACCOUNT, role: 'admin' } },
    );
    assert.equal(res.body.data.user.role, 'customer');
  });
});

describe('ZYV-56 CSRF protection', () => {
  it('rejects registration with no CSRF token', async () => {
    const res = await post('/api/auth/register', {
      body: VALID_ACCOUNT,
      csrf: false,
    });
    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'FORBIDDEN');
  });

  it('rejects a forged CSRF token', async () => {
    const res = await post('/api/auth/register', {
      body: VALID_ACCOUNT,
      csrf: 'forged-token-value',
    });
    assert.equal(res.status, 403);
  });

  it('rejects login with no CSRF token (login CSRF)', async () => {
    await register();
    const res = await post('/api/auth/login', {
      body: { identifier: EMAIL, password: PASSWORD },
      csrf: false,
    });
    assert.equal(res.status, 403);
  });

  it('issues a distinct token each time', async () => {
    const one = await csrf();
    const two = await csrf();
    assert.notEqual(one, two);
    assert.ok(one.length >= 32, 'token too short to be CSPRNG output');
  });
});

describe('ZYV-46 login', () => {
  it('signs in with an email address', async () => {
    await register();
    jar = new CookieJar();
    const res = await post<{ data: { user: { email: string } } }>(
      '/api/auth/login',
      { body: { identifier: EMAIL, password: PASSWORD } },
    );
    assert.equal(res.status, 200);
    assert.equal(res.body.data.user.email, EMAIL);
  });

  it('signs in with a mobile number', async () => {
    await register();
    jar = new CookieJar();
    const res = await post<{ data: { user: { mobile: string } } }>(
      '/api/auth/login',
      { body: { identifier: MOBILE, password: PASSWORD } },
    );
    assert.equal(res.status, 200);
    assert.equal(res.body.data.user.mobile, MOBILE);
  });

  it('refuses a wrong password', async () => {
    await register();
    jar = new CookieJar();
    const res = await post('/api/auth/login', {
      body: { identifier: EMAIL, password: 'definitely not the password' },
    });
    assert.equal(res.status, 401);
    assert.equal(res.body.error.code, 'INVALID_CREDENTIALS');
  });
});

describe('ZYV-53 session identity', () => {
  it('returns the profile from GET /me', async () => {
    await register();
    const me = await jarFetch<{ data: { user: { email: string } } }>(
      client,
      jar,
      '/api/auth/me',
    );
    assert.equal(me.status, 200);
    assert.equal(me.body.data.user.email, EMAIL);
  });

  it('returns 401 without a session', async () => {
    const res = await getJson401(client);
    assert.equal(res.status, 401);
  });
});

describe('ZYV-48 logout', () => {
  it('clears the session cookie', async () => {
    await register();
    assert.ok(jar.has(SESSION_COOKIE), 'setup: session cookie should exist');

    const res = await post('/api/auth/logout');
    assert.equal(res.status, 204);

    const cleared = res.headers.getSetCookie?.() ?? [];
    assert.ok(
      cleared.some(
        (c) =>
          c.startsWith(`${SESSION_COOKIE}=`) &&
          /Expires=Thu, 01 Jan 1970|Max-Age=0/i.test(c),
      ),
      'session cookie was not expired',
    );
    assert.ok(
      !jar.has(SESSION_COOKIE),
      'client still holds the session cookie',
    );
  });

  it('the session no longer works after logout', async () => {
    await register();
    await post('/api/auth/logout');
    const me = await jarFetch(client, jar, '/api/auth/me');
    assert.equal(me.status, 401);
  });
});

describe('ZYV-52 anti-enumeration', () => {
  it('responds identically for an unknown account and a wrong password', async () => {
    await register();

    const unknown = await post('/api/auth/login', {
      body: { identifier: 'ghost@example.invalid', password: 'whatever12345' },
    });
    const wrong = await post('/api/auth/login', {
      body: { identifier: EMAIL, password: 'definitely not the password' },
    });

    assert.equal(unknown.status, wrong.status);
    assert.deepEqual(unknown.body, wrong.body);
    assert.equal(unknown.body.error.code, 'INVALID_CREDENTIALS');
  });

  it('acknowledges forgot-password identically for real and unknown addresses', async () => {
    await register();

    const real = await post('/api/auth/forgot-password', {
      body: { email: EMAIL },
    });
    const ghost = await post('/api/auth/forgot-password', {
      body: { email: 'ghost@example.invalid' },
    });

    assert.equal(real.status, 202);
    assert.equal(ghost.status, 202);
    assert.deepEqual(ghost.body, real.body);
  });

  it('creates no reset token for an unknown address', async () => {
    const before = await db
      .selectFrom('password_reset_tokens')
      .selectAll()
      .execute();
    await post('/api/auth/forgot-password', {
      body: { email: 'ghost@example.invalid' },
    });
    const after_ = await db
      .selectFrom('password_reset_tokens')
      .selectAll()
      .execute();
    assert.equal(after_.length, before.length);
  });
});

describe('ZYV-50 password reset', () => {
  it('stores only a hash of the reset token', async () => {
    await register();
    await post('/api/auth/forgot-password', { body: { email: EMAIL } });

    const row = await db
      .selectFrom('password_reset_tokens')
      .innerJoin('users', 'users.id', 'password_reset_tokens.user_id')
      .select(['password_reset_tokens.token_hash'])
      .where('users.email', '=', EMAIL)
      .executeTakeFirstOrThrow();

    assert.match(row.token_hash, /^\$argon2id\$/);
  });

  it('invalidates any previous token when a new one is requested', async () => {
    await register();
    await post('/api/auth/forgot-password', { body: { email: EMAIL } });
    await post('/api/auth/forgot-password', { body: { email: EMAIL } });

    const rows = await db
      .selectFrom('password_reset_tokens')
      .innerJoin('users', 'users.id', 'password_reset_tokens.user_id')
      .select('password_reset_tokens.id')
      .where('users.email', '=', EMAIL)
      .execute();
    assert.equal(rows.length, 1, 'older reset tokens must be invalidated');
  });

  it('rejects a bogus reset token', async () => {
    await register();
    const res = await post('/api/auth/reset-password', {
      body: {
        token: 'a-completely-made-up-token-value',
        password: 'an entirely new passphrase',
        confirmPassword: 'an entirely new passphrase',
      },
    });
    assert.equal(res.status, 400);
  });

  it('rejects a weak replacement password', async () => {
    await register();
    const res = await post('/api/auth/reset-password', {
      body: {
        token: 'x'.repeat(40),
        password: 'weak',
        confirmPassword: 'weak',
      },
    });
    assert.equal(res.status, 400);
    assert.match(res.body.error.message, /at least 12/);
  });

  it('rejects a mismatched replacement password', async () => {
    await register();
    const res = await post('/api/auth/reset-password', {
      body: {
        token: 'x'.repeat(40),
        password: 'a long enough passphrase',
        confirmPassword: 'a different long passphrase',
      },
    });
    assert.equal(res.status, 400);
    assert.match(res.body.error.message, /do not match/i);
  });
});

async function getJson401(c: TestClient) {
  const res = await fetch(`${c.url}/api/auth/me`);
  return { status: res.status, body: await res.json().catch(() => null) };
}
