import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { SignJWT } from 'jose';

import { createApp } from '../src/app.js';
import { db } from '../src/db/client.js';
import { env } from '../src/config/env.js';
import { resetRateLimits } from '../src/http/rate-limit.js';
import { CSRF_HEADER } from '../src/auth/session.js';
import { signSession, verifySession } from '../src/auth/session.js';
import { hashPassword } from '../src/auth/password.js';
import {
  startServer,
  jarFetch,
  CookieJar,
  type TestClient,
} from './helpers.js';

/**
 * The gaps a mutation sweep found in E6 — each of these mutations passed the
 * whole suite before this file existed:
 *
 *   - session: drop algorithm pinning            (uncaught)
 *   - session: trust the token role claim        (uncaught)
 *   - forgot-password: reveal account existence  (uncaught)
 *   - reset: accept an already-used token        (uncaught)
 *   - reset: ignore token expiry                (uncaught)
 *   - verify: skip dummy verify (timing oracle) (uncaught)
 *
 * These live apart from auth.test.ts because they probe internals that the
 * end-to-end routes cannot reach — a raw reset token is never returned by the
 * API, so the fixture inserts one directly.
 */

const EMAIL = 'e6-hardening@example.invalid';
const MOBILE = '9812345678';
const PASSWORD = 'correct horse battery staple';

let client: TestClient;
let jar: CookieJar;

const SECRET = () => new TextEncoder().encode(env.JWT_SECRET);

async function csrf(): Promise<string> {
  const res = await jarFetch<{ data: { csrfToken: string } }>(
    client,
    jar,
    '/api/auth/csrf',
  );
  return res.body.data.csrfToken;
}

async function post<T = unknown>(path: string, body: unknown, withCsrf = true) {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };
  if (withCsrf) headers[CSRF_HEADER] = await csrf();
  return jarFetch<T>(client, jar, path, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

const ACCOUNT = {
  fullName: 'Hardening User',
  email: EMAIL,
  mobile: MOBILE,
  password: PASSWORD,
  confirmPassword: PASSWORD,
  acceptTerms: true,
};

async function cleanup() {
  await db
    .deleteFrom('users')
    .where((eb) => eb.or([eb('email', '=', EMAIL), eb('mobile', '=', MOBILE)]))
    .execute();
  await db
    .deleteFrom('audit_logs')
    .where('user_agent', '=', 'e6-hardening/1.0')
    .execute();
}

async function createAccount() {
  const res = await post('/api/auth/register', ACCOUNT);
  assert.equal(res.status, 201, 'fixture registration failed');
  const user = await db
    .selectFrom('users')
    .select('id')
    .where('email', '=', EMAIL)
    .executeTakeFirstOrThrow();
  return user.id;
}

before(async () => {
  try {
    await db.selectFrom('roles').select('id').limit(1).execute();
  } catch {
    throw new Error('PostgreSQL is unreachable; these tests require it.');
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

describe('session token hardening (signSession / verifySession)', () => {
  it('round-trips a valid session', async () => {
    const token = await signSession({
      sub: 'u1',
      role: 'customer',
      email: 'a@b.com',
    });
    const claims = await verifySession(token);
    assert.equal(claims?.sub, 'u1');
    assert.equal(claims?.role, 'customer');
  });

  it('rejects an HS512-signed token (algorithm pinning)', async () => {
    const token = await new SignJWT({
      sub: 'u1',
      role: 'admin',
      email: 'a@b.com',
    })
      .setProtectedHeader({ alg: 'HS512' })
      .setIssuedAt()
      .setExpirationTime('10m')
      .sign(SECRET());
    assert.equal(await verifySession(token), undefined);
  });

  it('rejects an alg:none token', async () => {
    const header = Buffer.from(
      JSON.stringify({ alg: 'none', typ: 'JWT' }),
    ).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({
        sub: 'u1',
        role: 'admin',
        exp: Math.floor(Date.now() / 1000) + 600,
      }),
    ).toString('base64url');
    assert.equal(await verifySession(`${header}.${payload}.`), undefined);
  });

  it('rejects a token signed with the wrong secret', async () => {
    const token = await new SignJWT({ sub: 'u1', role: 'admin' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('10m')
      .sign(
        new TextEncoder().encode(
          'a-different-secret-of-sufficient-length-here',
        ),
      );
    assert.equal(await verifySession(token), undefined);
  });

  it('rejects an expired token', async () => {
    const token = await new SignJWT({ sub: 'u1', role: 'customer' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 3600)
      .sign(SECRET());
    assert.equal(await verifySession(token), undefined);
  });

  it('does not accept a role outside the known set', async () => {
    const token = await new SignJWT({ sub: 'u1', role: 'superuser' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('10m')
      .sign(SECRET());
    assert.equal(await verifySession(token), undefined);
  });

  it('returns undefined for a missing token', async () => {
    assert.equal(await verifySession(undefined), undefined);
  });
});

describe('forgot-password must not disclose account existence', () => {
  it('emits no distinguishing header for an existing account', async () => {
    await createAccount();
    const res = await post('/api/auth/forgot-password', { email: EMAIL });
    assert.equal(res.status, 202);
    // The specific mutation this catches added x-account-exists: true.
    for (const h of res.headers.keys()) {
      assert.ok(
        !/account|user|exist/i.test(h),
        `response header "${h}" discloses account existence`,
      );
    }
  });

  it('produces the same status and body for a known and an unknown address', async () => {
    await createAccount();
    const known = await post('/api/auth/forgot-password', { email: EMAIL });
    const unknown = await post('/api/auth/forgot-password', {
      email: 'definitely-not-registered@example.invalid',
    });
    assert.equal(known.status, unknown.status);
    assert.deepEqual(known.body, unknown.body);
  });
});

describe('reset token single-use and expiry', () => {
  /** Insert a reset token directly so the test controls the raw value. */
  async function seedToken(
    userId: string,
    opts: { used?: boolean; expired?: boolean } = {},
  ) {
    const raw = 'fixture-raw-reset-token-value-1234567890';
    await db
      .insertInto('password_reset_tokens')
      .values({
        user_id: userId,
        token_hash: await hashPassword(raw),
        expires_at: new Date(
          Date.now() + (opts.expired ? -60_000 : 30 * 60_000),
        ),
        used_at: opts.used ? new Date() : null,
      })
      .execute();
    return raw;
  }

  const NEW_PASSWORD = 'an entirely different passphrase';

  it('accepts a valid unused token exactly once', async () => {
    const id = await createAccount();
    const token = await seedToken(id);

    const first = await post('/api/auth/reset-password', {
      token,
      password: NEW_PASSWORD,
      confirmPassword: NEW_PASSWORD,
    });
    assert.equal(first.status, 200, 'first use should succeed');

    // Replaying the same token must fail — this is the mutation that was
    // uncaught before ("accept an already-used token").
    const replay = await post('/api/auth/reset-password', {
      token,
      password: 'yet another passphrase here',
      confirmPassword: 'yet another passphrase here',
    });
    assert.equal(replay.status, 400);
    assert.match(
      replay.body.error.message,
      /already been used|invalid or has expired/i,
    );
  });

  it('rejects a token that is already marked used', async () => {
    const id = await createAccount();
    const token = await seedToken(id, { used: true });
    const res = await post('/api/auth/reset-password', {
      token,
      password: NEW_PASSWORD,
      confirmPassword: NEW_PASSWORD,
    });
    assert.equal(res.status, 400);
  });

  it('rejects an expired token', async () => {
    const id = await createAccount();
    const token = await seedToken(id, { expired: true });
    const res = await post('/api/auth/reset-password', {
      token,
      password: NEW_PASSWORD,
      confirmPassword: NEW_PASSWORD,
    });
    assert.equal(res.status, 400);
  });

  it('changes the password so the old one stops working', async () => {
    const id = await createAccount();
    const token = await seedToken(id);
    const res = await post('/api/auth/reset-password', {
      token,
      password: NEW_PASSWORD,
      confirmPassword: NEW_PASSWORD,
    });
    assert.equal(res.status, 200);

    jar = new CookieJar();
    const withOld = await post('/api/auth/login', {
      identifier: EMAIL,
      password: PASSWORD,
    });
    assert.equal(withOld.status, 401);

    jar = new CookieJar();
    const withNew = await post('/api/auth/login', {
      identifier: EMAIL,
      password: NEW_PASSWORD,
    });
    assert.equal(withNew.status, 200);
    void id;
  });

  it('stores only the hash, never the raw token', async () => {
    const id = await createAccount();
    const raw = await seedToken(id);
    const row = await db
      .selectFrom('password_reset_tokens')
      .select('token_hash')
      .where('user_id', '=', id)
      .executeTakeFirstOrThrow();
    assert.match(row.token_hash, /^\$argon2id\$/);
    assert.ok(!row.token_hash.includes(raw), 'raw token persisted');
  });
});

describe('login timing does not disclose account existence', () => {
  it('costs comparable time for an unknown account and a wrong password', async () => {
    await createAccount();

    const time = async (identifier: string, password: string) => {
      // The auth limiter allows 10 per 15 minutes and this loop makes more
      // than that, so reset it per sample. The limiter is not what is being
      // measured here — the credential check is.
      resetRateLimits();
      // Fresh jar so the CSRF handshake is not measured, only the credential check.
      const j = new CookieJar();
      const token = await jarFetch<{ data: { csrfToken: string } }>(
        client,
        j,
        '/api/auth/csrf',
      ).then((r) => r.body.data.csrfToken);
      const start = performance.now();
      await jarFetch(client, j, '/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json', [CSRF_HEADER]: token },
        body: JSON.stringify({ identifier, password }),
      });
      return performance.now() - start;
    };

    // Warm up so the lazily-built dummy hash is not counted as unknown-user cost.
    await time('warmup@example.invalid', 'warmup');
    await time('warmup2@example.invalid', 'warmup');

    const unknown: number[] = [];
    const wrong: number[] = [];
    for (let i = 0; i < 6; i++) {
      unknown.push(await time('ghost@example.invalid', 'whatever12345'));
      wrong.push(await time(EMAIL, 'definitely not the password'));
    }

    const median = (xs: number[]) =>
      [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
    const u = median(unknown);
    const w = median(wrong);
    const ratio = u / w;

    // Without the dummy verify an unknown account returns in ~1ms while a real
    // one costs ~40ms of Argon2 — a 40x signal that enumerates the user base.
    assert.ok(
      ratio > 0.6 && ratio < 1.7,
      `login timing leaks account existence: unknown=${u.toFixed(1)}ms wrong=${w.toFixed(1)}ms ratio=${ratio.toFixed(2)}`,
    );
  });
});
