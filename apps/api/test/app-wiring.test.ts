import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { SignJWT } from 'jose';

import { createApp } from '../src/app.js';
import { db } from '../src/db/client.js';
import { SESSION_COOKIE } from '../src/http/auth.js';
import { startServer, getJson, type TestClient } from './helpers.js';

/**
 * Integration tests against the REAL application composition.
 *
 * Every other spec in this directory builds its own `express()` app. That
 * proved the middleware works, but not that `createApp()` wires it correctly.
 * A mutation sweep found that deleting `requireAdmin` from src/app.ts — the
 * line that stops a customer reaching administrator APIs — failed zero tests.
 * The entire admin boundary was therefore untested in the only place it
 * actually runs.
 *
 * These tests drive `createApp()` over a real PostgreSQL session, so they
 * fail if the production wiring changes.
 */

const JWT_SECRET = 'dev-secret-change-in-production-min-32-chars';
const ADMIN_ID = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const CUSTOMER_ID = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';

let dbAvailable = false;
let client: TestClient;

async function canReachDb(): Promise<boolean> {
  try {
    await db.selectFrom('roles').select('id').limit(1).execute();
    return true;
  } catch {
    return false;
  }
}

async function seedUsers(): Promise<void> {
  const roles = await db.selectFrom('roles').select(['id', 'name']).execute();
  const admin = roles.find((r) => r.name === 'admin');
  const customer = roles.find((r) => r.name === 'customer');
  if (!admin || !customer) throw new Error('roles missing — run npm run seed');

  await db
    .insertInto('users')
    .values([
      {
        id: ADMIN_ID,
        email: 'wiring-admin@example.invalid',
        password_hash: 'not-a-real-hash',
        full_name: 'Wiring Admin',
        role_id: admin.id,
      },
      {
        id: CUSTOMER_ID,
        email: 'wiring-customer@example.invalid',
        password_hash: 'not-a-real-hash',
        full_name: 'Wiring Customer',
        role_id: customer.id,
      },
    ])
    .onConflict((oc) => oc.column('id').doNothing())
    .execute();
}

async function cleanup(): Promise<void> {
  await db
    .deleteFrom('users')
    .where('id', 'in', [ADMIN_ID, CUSTOMER_ID])
    .execute();
  await db
    .deleteFrom('audit_logs')
    .where('user_agent', '=', 'app-wiring-test/1.0')
    .execute();
}

async function token(
  sub: string,
  role: string,
  alg = 'HS256',
  secret = JWT_SECRET,
): Promise<string> {
  return new SignJWT({ sub, role })
    .setProtectedHeader({ alg })
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(new TextEncoder().encode(secret));
}

const cookie = (t: string) => ({ cookie: `${SESSION_COOKIE}=${t}` });

before(async () => {
  dbAvailable = await canReachDb();
  if (!dbAvailable) {
    throw new Error(
      'PostgreSQL is unreachable. These tests exercise the real session path and cannot ' +
        'run without it. Start it or set ZYVORA_ALLOW_SKIP_DB=1.',
    );
  }
  await seedUsers();
  client = await startServer(createApp());
});

after(async () => {
  await client?.close();
  await cleanup();
  await db.destroy();
});

describe('createApp() admin boundary wiring', () => {
  it('rejects an anonymous request to /api/admin with 401', async () => {
    const res = await getJson(client, '/api/admin/audit-log');
    assert.equal(res.status, 401);
    assert.equal(res.body.error.code, 'AUTH_REQUIRED');
  });

  it('rejects a CUSTOMER session with 403 — the admin role check is live', async () => {
    // This is the assertion that fails if `requireAdmin` is dropped from app.ts.
    const t = await token(CUSTOMER_ID, 'customer');
    const res = await getJson(client, '/api/admin/audit-log', {
      headers: cookie(t),
    });
    assert.equal(res.status, 403, 'a customer reached an admin endpoint');
    assert.equal(res.body.error.code, 'FORBIDDEN');
  });

  it('allows an ADMIN session through', async () => {
    const t = await token(ADMIN_ID, 'admin');
    const res = await getJson(client, '/api/admin/audit-log', {
      headers: cookie(t),
    });
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.data));
  });

  it('leaves the public catalog reachable without a session', async (t) => {
    const res = await getJson(client, '/api/products?pageSize=1');
    assert.equal(
      res.status,
      200,
      'admin enforcement leaked onto the public API',
    );
    void t;
  });

  it('rejects a customer on every admin sub-path, not just one', async () => {
    const t = await token(CUSTOMER_ID, 'customer');
    for (const path of [
      '/api/admin/audit-log',
      '/api/admin/audit-log/aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa',
      '/api/admin/anything-else',
    ]) {
      const res = await getJson(client, path, { headers: cookie(t) });
      assert.ok(
        res.status === 403,
        `${path} returned ${res.status}, expected 403`,
      );
    }
  });
});

describe('session token hardening in the real app', () => {
  it('rejects an HS512-signed token — algorithm pinning is live', async () => {
    // jose only signs HS512 when the key is long enough; ours is 43 chars.
    const t = await token(ADMIN_ID, 'admin', 'HS512');
    const res = await getJson(client, '/api/admin/audit-log', {
      headers: cookie(t),
    });
    assert.equal(
      res.status,
      401,
      'a token signed with a non-pinned algorithm was accepted',
    );
  });

  it('rejects an alg:none token', async () => {
    const header = Buffer.from(
      JSON.stringify({ alg: 'none', typ: 'JWT' }),
    ).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({
        sub: ADMIN_ID,
        role: 'admin',
        exp: Math.floor(Date.now() / 1000) + 600,
      }),
    ).toString('base64url');
    const res = await getJson(client, '/api/admin/audit-log', {
      headers: cookie(`${header}.${payload}.`),
    });
    assert.equal(res.status, 401);
  });

  it('rejects a token signed with the wrong secret', async () => {
    const t = await token(
      ADMIN_ID,
      'admin',
      'HS256',
      'a-completely-different-secret-of-length',
    );
    const res = await getJson(client, '/api/admin/audit-log', {
      headers: cookie(t),
    });
    assert.equal(res.status, 401);
  });

  it('ignores an Authorization header — only the cookie is trusted', async () => {
    const t = await token(ADMIN_ID, 'admin');
    const res = await getJson(client, '/api/admin/audit-log', {
      headers: { authorization: `Bearer ${t}` },
    });
    assert.equal(
      res.status,
      401,
      'a bearer token was accepted without a cookie',
    );
  });

  it('takes the role from the DATABASE, not the token body', async () => {
    // The token claims admin, but the row says customer. resolveUser re-reads
    // the user, so the forged claim must not grant access. This is the test
    // that fails if the per-request re-read is removed.
    const forged = await token(CUSTOMER_ID, 'admin');
    const res = await getJson(client, '/api/admin/audit-log', {
      headers: cookie(forged),
    });
    assert.equal(
      res.status,
      403,
      'a forged role claim in the token was trusted',
    );
  });

  it('rejects a token whose user has been deleted', async () => {
    const gone = 'cccccccc-3333-4333-8333-cccccccccccc';
    const t = await token(gone, 'admin');
    const res = await getJson(client, '/api/admin/audit-log', {
      headers: cookie(t),
    });
    assert.equal(res.status, 401);
  });

  it('rejects an expired token', async () => {
    const expired = await new SignJWT({ sub: ADMIN_ID, role: 'admin' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 3600)
      .sign(new TextEncoder().encode(JWT_SECRET));
    const res = await getJson(client, '/api/admin/audit-log', {
      headers: cookie(expired),
    });
    assert.equal(res.status, 401);
  });
});
