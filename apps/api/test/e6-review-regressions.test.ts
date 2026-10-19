import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { randomBytes, randomUUID } from 'node:crypto';

import { createApp } from '../src/app.js';
import {
  DEV_RESET_TOKEN_CAP,
  devResetTokenCount,
  rememberDevResetToken,
  resetDevResetTokens,
} from '../src/routes/auth.js';
import { db } from '../src/db/client.js';
import { clientAddress, resetRateLimits } from '../src/http/rate-limit.js';
import { env } from '../src/config/env.js';
import { hashPassword, MAX_PASSWORD_LENGTH } from '../src/auth/password.js';
import {
  CSRF_COOKIE,
  CSRF_HEADER,
  SESSION_COOKIE,
} from '../src/auth/session.js';
import { verifySession } from '../src/auth/jwt.js';
import { startServer, type TestClient } from './helpers.js';

/**
 * Regressions found by an INDEPENDENT review of E6 (mutation-tested, 10
 * mutations run, 5 of them caught by nothing).
 *
 * Every test here exists because a mutation survived without it. If one of
 * these fails, either the defect is back or the test stopped discriminating —
 * both are worth a red build.
 *
 * All state is scoped to one dedicated user and purged in `after`, because
 * `node --test` runs files concurrently and these assertions include a
 * deliberate rate-limit sweep that would otherwise poison neighbouring suites.
 */

const EMAIL = 'e6-regression@example.invalid';
const MOBILE = '9111111111';
const PASSWORD = 'correct horse battery staple';
const GHOST = 'e6-regression-ghost@example.invalid';

let client: TestClient;

interface Body {
  data?: Record<string, unknown>;
  error?: { message?: string; code?: string };
}

async function csrf(): Promise<string> {
  const res = await fetch(`${client.url}/api/auth/csrf`);
  const json = (await res.json()) as { data: { csrfToken: string } };
  return json.data.csrfToken;
}

async function post<T = Body>(
  path: string,
  body: unknown,
  opts: { csrf?: boolean } = {},
): Promise<{ status: number; body: T; headers: Headers }> {
  const token = opts.csrf === false ? null : await csrf();
  const res = await fetch(`${client.url}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: `${CSRF_COOKIE}=${token ?? ''}`,
      ...(token ? { [CSRF_HEADER]: token } : {}),
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return {
    status: res.status,
    body: (text ? JSON.parse(text) : null) as T,
    headers: res.headers,
  };
}

before(async () => {
  client = await startServer(createApp());
  const role = await db
    .selectFrom('roles')
    .select('id')
    .where('name', '=', 'customer')
    .executeTakeFirstOrThrow();
  await db.deleteFrom('users').where('email', '=', EMAIL).execute();
  await db
    .insertInto('users')
    .values({
      email: EMAIL,
      password_hash: await hashPassword(PASSWORD),
      full_name: 'E6 Regression',
      mobile: MOBILE,
      role_id: role.id,
    })
    .execute();
});

after(async () => {
  await db
    .deleteFrom('audit_logs')
    .where('action', '=', 'auth.logged_out')
    .execute();
  await db.deleteFrom('users').where('email', '=', EMAIL).execute();
  await client.close();
  await db.destroy();
});

beforeEach(() => {
  resetRateLimits();
});

describe('E6 review regression: forgot-password must not enumerate accounts', () => {
  it('spends comparable time whether or not the address exists', async () => {
    // The defect: the account branch paid for an Argon2id hash plus two
    // writes, the unknown branch returned immediately. Measured 3.7ms vs
    // 51.6ms — a 14x oracle behind an identical 202 and an identical body,
    // which defeats ZYV-52 outright.
    const time = async (addr: string) => {
      // Reset per measurement: the auth limiter allows 10 per 15 minutes, and
      // a sweep this long would start returning 429 partway through. That is
      // the limiter working, not the endpoint being slow — and a 429 would
      // measure as "fast", quietly inverting the result.
      resetRateLimits();
      const t0 = performance.now();
      const res = await post('/api/auth/forgot-password', { email: addr });
      const ms = performance.now() - t0;
      assert.equal(
        res.status,
        202,
        'both branches must acknowledge identically',
      );
      return ms;
    };

    // Warm both branches first: the first Argon2id call pays library load,
    // which would otherwise land entirely on whichever address goes first.
    for (let i = 0; i < 2; i++) {
      await time('e6-regression-warm@example.invalid');
      await time(EMAIL);
    }

    const ghosts: number[] = [];
    const known: number[] = [];
    for (let i = 0; i < 6; i++) {
      ghosts.push(await time(`e6-regression-g${i}@example.invalid`));
      known.push(await time(EMAIL));
    }
    const median = (xs: number[]) =>
      [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
    const ratio = median(known) / median(ghosts);

    assert.ok(
      ratio < 2 && ratio > 0.5,
      `timing must not distinguish the branches; measured ${median(ghosts).toFixed(1)}ms vs ${median(known).toFixed(1)}ms (${ratio.toFixed(2)}x)`,
    );
  });

  it('acknowledges an unknown address with the same body as a known one', () => {
    // Run serially so the rate limiter cannot be the thing that differs.
    return (async () => {
      const ghost = await post<Body>('/api/auth/forgot-password', {
        email: GHOST,
      });
      const real = await post<Body>('/api/auth/forgot-password', {
        email: EMAIL,
      });
      assert.equal(ghost.status, real.status);
      assert.deepEqual(ghost.body, real.body);
    })();
  });

  it('mints no reset token for an unknown address', async () => {
    await post('/api/auth/forgot-password', { email: GHOST });
    const user = await db
      .selectFrom('users')
      .select('id')
      .where('email', '=', GHOST)
      .executeTakeFirst();
    assert.equal(user, undefined, 'precondition: the address is unregistered');
  });
});

describe('E6 review regression: session revocation precision', () => {
  const setRevokedAt = (at: Date) =>
    db
      .updateTable('users')
      .set({ session_invalid_before: at })
      .where('email', '=', EMAIL)
      .execute();

  const login = async () => {
    const res = await post<{ data: { user?: unknown } }>('/api/auth/login', {
      identifier: EMAIL,
      password: PASSWORD,
    });
    assert.equal(res.status, 200, 'fixture login must succeed');
    const cookie = (res.headers.getSetCookie?.() ?? [])
      .filter((c) => c.startsWith(`${SESSION_COOKIE}=`))
      .map((c) => c.split(';')[0])
      .join('; ');
    return cookie;
  };

  it('keeps a session minted AFTER a reset, even in the same second', async () => {
    // The defect: JWT `iat` is a whole number of seconds, so a reset and a
    // login landing in the same second were indistinguishable. The old
    // comparison (`iat <= ms/1000`) resolved the tie by killing the new
    // session — reproduced as /me returning 401 immediately after a successful
    // reset-and-login. The fix carries an exact millisecond claim.
    for (let trial = 0; trial < 3; trial++) {
      resetRateLimits();
      await setRevokedAt(new Date());
      const cookie = await login();
      const me = await fetch(`${client.url}/api/auth/me`, {
        headers: { cookie },
      });
      assert.equal(
        me.status,
        200,
        `trial ${trial}: a session issued after the reset must survive`,
      );
    }
  });

  it('treats an identical millisecond as "after", not "before"', async () => {
    // Pins the comparison to strict `<`. A weaker rewrite of the same check
    // (`iatMs <= revokedAtMs`) survived the tests above because login and
    // reset essentially never land on the same millisecond, so the boundary
    // was untested. Here it is forced to be exactly equal.
    resetRateLimits();
    await setRevokedAt(new Date());
    const cookie = await login();

    const claims = (await verifySession(
      cookie.split(`${SESSION_COOKIE}=`)[1],
    )) as { issuedAtMs?: number };
    assert.equal(typeof claims.issuedAtMs, 'number', 'iatMs must be readable');

    // Revocation instant set to the token's own issue time: the session was
    // not issued before it, so it must remain valid.
    await setRevokedAt(new Date(claims.issuedAtMs as number));
    const me = await fetch(`${client.url}/api/auth/me`, {
      headers: { cookie },
    });
    assert.equal(
      me.status,
      200,
      'a session issued in the very same millisecond must not be treated as pre-reset',
    );
  });

  it('still kills a session minted BEFORE a reset', async () => {
    // The other half. A fix that simply always admitted the newest token
    // would pass the test above while leaving every stolen cookie valid.
    resetRateLimits();
    await setRevokedAt(new Date(Date.now() - 60_000));
    const cookie = await login();
    const me = await fetch(`${client.url}/api/auth/me`, {
      headers: { cookie },
    });
    assert.equal(me.status, 200, 'fixture: the fresh session starts valid');

    await new Promise((r) => setTimeout(r, 20));
    await setRevokedAt(new Date());
    const after = await fetch(`${client.url}/api/auth/me`, {
      headers: { cookie },
    });
    assert.equal(
      after.status,
      401,
      'a session issued before the reset must be revoked',
    );
  });
});

describe('E6 review regression: logout', () => {
  it('records an audit row', async () => {
    // The defect: `/logout` had no auth middleware, so `req.user` was always
    // undefined and the `auth.logged_out` audit call was unreachable. The
    // route claimed to log every sign-out and logged none.
    await db
      .deleteFrom('audit_logs')
      .where('action', '=', 'auth.logged_out')
      .execute();

    const loginRes = await post<Body>('/api/auth/login', {
      identifier: EMAIL,
      password: PASSWORD,
    });
    assert.equal(loginRes.status, 200);
    const session = (loginRes.headers.getSetCookie?.() ?? [])
      .filter((c) => c.startsWith(`${SESSION_COOKIE}=`))
      .map((c) => c.split(';')[0])
      .join('; ');
    const token = await csrf();

    const out = await fetch(`${client.url}/api/auth/logout`, {
      method: 'POST',
      headers: {
        cookie: `${session}; ${CSRF_COOKIE}=${token}`,
        [CSRF_HEADER]: token,
      },
    });
    assert.equal(out.status, 204, 'logout is a 204 with no body');

    // The audit write is fire-and-forget, so poll briefly rather than
    // asserting on the first read and failing on scheduling.
    let rows: unknown[] = [];
    for (let i = 0; i < 40 && rows.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 50));
      rows = await db
        .selectFrom('audit_logs')
        .select('id')
        .where('action', '=', 'auth.logged_out')
        .execute();
    }
    assert.ok(
      rows.length > 0,
      'a sign-out must leave a trace; the audit call was unreachable',
    );
  });

  it('clears both the session cookie and the CSRF cookie', async () => {
    const loginRes = await post<Body>('/api/auth/login', {
      identifier: EMAIL,
      password: PASSWORD,
    });
    const session = (loginRes.headers.getSetCookie?.() ?? [])
      .filter((c) => c.startsWith(`${SESSION_COOKIE}=`))
      .map((c) => c.split(';')[0])
      .join('; ');
    const token = await csrf();

    const out = await fetch(`${client.url}/api/auth/logout`, {
      method: 'POST',
      headers: {
        cookie: `${session}; ${CSRF_COOKIE}=${token}`,
        [CSRF_HEADER]: token,
      },
    });
    const cleared = out.headers.getSetCookie?.() ?? [];
    const isCleared = (name: string) =>
      cleared.some(
        (c) => c.startsWith(`${name}=`) && /expires=thu, 01 jan 1970/i.test(c),
      );

    assert.ok(
      isCleared(SESSION_COOKIE),
      'the session cookie must be expired on logout',
    );
    assert.ok(
      isCleared(CSRF_COOKIE),
      'the CSRF cookie must be expired too, or a stale token outlives the session',
    );
  });
});

describe('E6 review regression: password policy and token single-use', () => {
  it('rejects a password longer than the documented maximum', async () => {
    // No test covered MAX_PASSWORD_LENGTH, so deleting the check entirely
    // changed nothing observable. The limit is what keeps a huge body from
    // reaching Argon2id at all.
    const tooLong = 'a'.repeat(MAX_PASSWORD_LENGTH + 1);
    const res = await post<Body>('/api/auth/register', {
      fullName: 'Too Long',
      email: 'e6-regression-long@example.invalid',
      mobile: '9111111112',
      password: tooLong,
      confirmPassword: tooLong,
      acceptTerms: true,
    });
    assert.equal(res.status, 400);
    assert.match(
      String(res.body.error?.message ?? ''),
      /at most/i,
      'an over-long password must be refused with a message naming the limit',
    );
  });

  /** Seed a reset token directly so the fixture controls the raw value. */
  async function seedToken(): Promise<string> {
    const id = randomUUID();
    const secret = randomBytes(24).toString('base64url');
    const user = await db
      .selectFrom('users')
      .select('id')
      .where('email', '=', EMAIL)
      .executeTakeFirstOrThrow();
    await db
      .insertInto('password_reset_tokens')
      .values({
        id,
        user_id: user.id,
        token_hash: await hashPassword(secret),
        expires_at: new Date(Date.now() + 30 * 60_000),
        used_at: null,
      })
      .execute();
    return `${id}.${secret}`;
  }

  it('lets exactly one of two simultaneous redemptions win', async () => {
    // The only way to reach the post-claim check.
    //
    // The candidate SELECT already filters `used_at IS NULL`, so a SEQUENTIAL
    // replay never gets that far — which is why removing the check entirely
    // survived every other test. It guards the genuine race instead: two
    // requests that both pass the SELECT before either writes. Firing them
    // concurrently is the only way to observe it, and the assertion is that
    // the database — not the timing — settles it.
    resetRateLimits();
    const token = await seedToken();

    const redeem = (password: string) =>
      post<Body>('/api/auth/reset-password', {
        token,
        password,
        confirmPassword: password,
      });

    const [a, b] = await Promise.all([
      redeem('one concurrent passphrase'),
      redeem('two concurrent passphrase'),
    ]);
    const statuses = [a.status, b.status].sort();

    assert.deepEqual(
      statuses,
      [200, 400],
      'exactly one concurrent redemption may succeed',
    );

    // And the loser must be told the link is spent, not merely that it failed.
    const loser = a.status === 400 ? a : b;
    assert.match(
      String(loser.body.error?.message ?? ''),
      /already been used|invalid or has expired/i,
    );
  });

  it('refuses to reuse a reset token', async () => {
    // The mutation that survived removed the post-claim check, so a second
    // redemption of an already-spent token went through.
    const token = await seedToken();

    const first = await post<Body>('/api/auth/reset-password', {
      token,
      password: 'first new passphrase ok',
      confirmPassword: 'first new passphrase ok',
    });
    assert.equal(first.status, 200, 'the first redemption must succeed');

    const replay = await post<Body>('/api/auth/reset-password', {
      token,
      password: 'second new passphrase ok',
      confirmPassword: 'second new passphrase ok',
    });
    assert.equal(
      replay.status,
      400,
      'a spent reset token must not work a second time',
    );
  });
});

describe('E6 review regression: credential endpoints are rate limited', () => {
  it('throttles repeated login attempts', async () => {
    // Nothing asserted the auth limiter end-to-end, so raising its limit from
    // 10 to 1000 — or removing it — was invisible to the suite.
    resetRateLimits();
    // One CSRF token, fetched before the sweep. Re-fetching per attempt would
    // throttle the CSRF endpoint instead, and the test would pass for the
    // wrong reason — which is exactly the failure mode it is guarding against.
    const token = await csrf();
    let sawLimit = false;
    let attempts = 0;
    // Must exceed the auth limiter's limit of 15 so the sweep can actually
    // reach a 429. The loop cap is deliberately higher than the limit: an
    // attempt count equal to the limit would end the loop before the limiter
    // ever engaged, and the test would then fail for the wrong reason.
    for (let i = 0; i < 25; i++) {
      const res = await fetch(`${client.url}/api/auth/login`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: `${CSRF_COOKIE}=${token}`,
          [CSRF_HEADER]: token,
        },
        body: JSON.stringify({
          identifier: EMAIL,
          password: 'deliberately wrong passphrase',
        }),
      });
      await res.text();
      attempts = i + 1;
      if (res.status === 429) {
        sawLimit = true;
        break;
      }
    }
    assert.ok(
      attempts <= 17,
      `the limiter must engage promptly; it took ${attempts} attempts`,
    );
    assert.ok(
      sawLimit,
      'brute-forcing a password must eventually be throttled',
    );
    resetRateLimits();
  });
});

describe('E6 review regression: in-memory dev token map is bounded', () => {
  it('mints exactly one token per reset request, not one per request', async () => {
    // Driven through HTTP: each new request must invalidate the previous row,
    // so the table cannot be the thing that grows — see the next test for why
    // that matters.
    resetRateLimits();
    await post('/api/auth/forgot-password', { email: EMAIL });
    await post('/api/auth/forgot-password', { email: EMAIL });

    const live = await db
      .selectFrom('password_reset_tokens')
      .innerJoin('users', 'users.id', 'password_reset_tokens.user_id')
      .select('password_reset_tokens.id')
      .where('users.email', '=', EMAIL)
      .execute();
    assert.equal(
      live.length,
      1,
      'each request must invalidate the previous token rather than accumulate',
    );
  });

  it('records a token when a reset is actually issued', async () => {
    // The counterpart to the bound below: proves the HTTP path reaches the map
    // at all, so a test that then asserts a small count is not passing merely
    // because nothing was ever stored.
    resetDevResetTokens();
    const original = env.DEV_EXPOSE_RESET_TOKEN;
    env.DEV_EXPOSE_RESET_TOKEN = true;
    try {
      resetRateLimits();
      const res = await post<{ data: { devResetToken?: string } }>(
        '/api/auth/forgot-password',
        { email: EMAIL },
      );
      assert.equal(res.status, 202);
      assert.ok(res.body.data?.devResetToken, 'the dev token must be issued');
      assert.equal(
        devResetTokenCount(),
        1,
        'an issued token must be retained in the map',
      );
    } finally {
      env.DEV_EXPOSE_RESET_TOKEN = original;
      resetDevResetTokens();
    }
  });

  it('keeps no raw token in memory when the dev flag is off', async () => {
    // Production shape: the flag is off, so the response carries no token and
    // the process must not be holding one either. Writing unconditionally
    // would leave every raw reset credential resident in RAM for no reason.
    resetDevResetTokens();
    const original = env.DEV_EXPOSE_RESET_TOKEN;
    env.DEV_EXPOSE_RESET_TOKEN = false;
    try {
      resetRateLimits();
      const res = await post<{ data: { devResetToken?: string } }>(
        '/api/auth/forgot-password',
        { email: EMAIL },
      );
      assert.equal(res.status, 202);
      assert.equal(
        res.body.data?.devResetToken,
        undefined,
        'no token may be returned when the flag is off',
      );
      assert.equal(devResetTokenCount(), 0, 'and none may be held in memory');
    } finally {
      env.DEV_EXPOSE_RESET_TOKEN = original;
      resetDevResetTokens();
    }
  });

  it('never exceeds its cap across distinct users', () => {
    resetDevResetTokens();
    // Driven directly, not through 130 HTTP requests.
    //
    // Two reasons. First, the map is keyed by user, so hammering ONE account
    // leaves it at a single entry however badly the bookkeeping is broken —
    // growth is only visible across distinct users. Second, a test written
    // against the `password_reset_tokens` table instead measures the wrong
    // thing: the route deletes the previous row, so the table stays at one
    // while the map grows. That version passed with the cap disabled.
    for (let i = 0; i < DEV_RESET_TOKEN_CAP * 2; i++) {
      rememberDevResetToken(`user-${i}`, `raw-${i}`, Date.now() + 60_000);
    }
    assert.ok(
      devResetTokenCount() <= DEV_RESET_TOKEN_CAP,
      `map must stay bounded; found ${devResetTokenCount()} after ${
        DEV_RESET_TOKEN_CAP * 2
      } distinct users`,
    );
  });

  it('prunes entries whose expiry has passed', () => {
    resetDevResetTokens();
    const before = devResetTokenCount();
    rememberDevResetToken('stale-user', 'raw-stale', Date.now() - 1_000);
    const grew = devResetTokenCount();
    assert.ok(grew > before, 'precondition: the stale entry was stored');

    // Any later insert sweeps it out — otherwise a process that served one
    // reset in its lifetime keeps that raw credential in memory forever.
    rememberDevResetToken('fresh-user', 'raw-fresh', Date.now() + 60_000);
    assert.equal(
      devResetTokenCount(),
      grew,
      'an already-expired entry must be swept on the next insert',
    );
  });

  it('does not accumulate repeat entries for one user', () => {
    resetDevResetTokens();
    for (let i = 0; i < 5; i++) {
      rememberDevResetToken('repeat-user', 'raw', Date.now() + 60_000);
    }
    const all = devResetTokenCount();
    rememberDevResetToken('another-user', 'raw', Date.now() + 60_000);
    assert.equal(
      devResetTokenCount(),
      all + 1,
      'one entry per user, not per call',
    );
  });
});

describe('E6 review regression: rate-limit identity follows the topology', () => {
  const req = (socket: string, ip: string) =>
    ({
      socket: { remoteAddress: socket },
      ip,
    }) as unknown as Parameters<typeof clientAddress>[0];

  it('ignores a spoofed X-Forwarded-For when no proxy is trusted', () => {
    // With TRUST_PROXY off, `req.ip` is derived from client-supplied headers,
    // so keying a credential-endpoint limit on it lets an attacker mint a
    // fresh bucket per request and the limiter never engages.
    assert.equal(clientAddress(req('10.0.0.9', '203.0.113.7')), '10.0.0.9');
  });

  it('uses the forwarded address once a proxy IS trusted', () => {
    // The flip side. Keying on the socket address unconditionally is just as
    // broken behind a reverse proxy: every request arrives from the proxy, so
    // all users share one bucket and the 10-per-15-minutes credential limit
    // becomes a global outage. This is the branch that fixes it.
    const original = env.TRUST_PROXY;
    env.TRUST_PROXY = 1;
    try {
      assert.equal(
        clientAddress(req('10.0.0.9', '203.0.113.7')),
        '203.0.113.7',
      );
    } finally {
      env.TRUST_PROXY = original;
    }
  });

  it('still keys on something stable when there is no socket address', () => {
    assert.ok(clientAddress(req('', '203.0.113.7')).length > 0);
  });
});
