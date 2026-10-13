import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import express from 'express';
import { z } from 'zod';

import { db } from '../src/db/client.js';
import { audit, auditAdmin } from '../src/audit/audit-log.js';
import { requireAdmin, requireRole } from '../src/http/rbac.js';
import { errorHandler, notFoundHandler } from '../src/http/error-handler.js';
import { asyncHandler } from '../src/http/async-handler.js';
import { validate, valid } from '../src/http/validate.js';
import { startServer, getJson, type TestClient } from './helpers.js';

/**
 * ZYV-31 — audit hooks, exercised END TO END against PostgreSQL.
 *
 * The previous state of this story was an `audit()` function with zero call
 * sites and no execution record: `audit_logs` held 0 rows. These tests run the
 * real middleware through a real Express pipeline and assert the row actually
 * lands in the table.
 *
 * Requires a reachable database. Skipped loudly rather than silently passing
 * if one is not available — a green run that never touched the database is
 * exactly the false confidence this story already produced once.
 */

let dbAvailable = false;

async function canReachDb(): Promise<boolean> {
  try {
    await db.selectFrom('audit_logs').select('id').limit(1).execute();
    return true;
  } catch {
    return false;
  }
}

/** Minimal stand-in for a request object; audit() only reads these fields. */
function fakeReq(overrides: Record<string, unknown> = {}) {
  return {
    ip: '::ffff:127.0.0.1',
    get: () => AUDIT_TEST_UA,
    user: undefined,
    params: {},
    method: 'PATCH',
    path: '/api/admin/products/1',
    valid: {},
    ...overrides,
  } as never;
}

/** auditRoute fires on `finish`, so allow the insert to land before asserting. */
async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 25));
}

const AUDIT_TEST_UA = 'audit-test/1.0';

const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';

/**
 * `audit_logs.user_id` has a real foreign key to `users(id)`. The
 * middleware records the actor from the session, so an integration test has to
 * use a row that genuinely exists — the database correctly refuses to
 * attribute an action to a non-existent user.
 */
async function createTestAdmin(): Promise<void> {
  const role = await db
    .selectFrom('roles')
    .select('id')
    .where('name', '=', 'admin')
    .executeTakeFirst();
  if (!role) throw new Error('admin role missing — run npm run seed');
  await db
    .insertInto('users')
    .values({
      id: UUID_A,
      email: 'audit-test-admin@example.invalid',
      password_hash: 'not-a-real-hash',
      full_name: 'Audit Test Admin',
      role_id: role.id,
    })
    .onConflict((oc) => oc.column('id').doNothing())
    .execute();
}

async function dropTestAdmin(): Promise<void> {
  await db.deleteFrom('users').where('id', '=', UUID_A).execute();
  // audit_logs.user_id is ON DELETE SET NULL, so the rows stay as evidence but
  // no longer reference a removed user.
}

/**
 * Remove every audit row this suite created.
 *
 * Without this the table accumulates rows on every run, so a real
 * administrative action would be buried in test noise and the E10-S11 viewer
 * would be useless against a development database.
 */
async function purgeTestAuditRows(): Promise<void> {
  await db
    .deleteFrom('audit_logs')
    .where('user_agent', '=', AUDIT_TEST_UA)
    .execute();
}

before(async () => {
  dbAvailable = await canReachDb();
  if (!dbAvailable) {
    console.warn(
      '[audit] PostgreSQL unreachable — ZYV-31 integration tests will be SKIPPED, not passed',
    );
    return;
  }
  await createTestAdmin();
});

after(async () => {
  if (dbAvailable) {
    await purgeTestAuditRows();
    await dropTestAdmin();
  }
  await db.destroy();
});

describe('ZYV-31 audit hooks (live database)', () => {
  it('writes a row and returns its id', async (t) => {
    if (!dbAvailable) return t.skip('no database');

    const res = await audit(fakeReq(), {
      action: 'product.updated',
      entityType: 'product',
      entityId: UUID_A,
      newValues: { price: 1999 },
    });

    assert.equal(res.ok, true, `audit failed: ${res.error}`);
    assert.ok(res.id, 'expected an audit row id');

    const row = await db
      .selectFrom('audit_logs')
      .selectAll()
      .where('id', '=', res.id!)
      .executeTakeFirstOrThrow();

    assert.equal(row.action, 'product.updated');
    assert.equal(row.entity_type, 'product');
    assert.equal(row.entity_id, UUID_A);
    assert.deepEqual(row.new_values, { price: 1999 });
    assert.equal(row.ip_address, '::ffff:127.0.0.1');
  });

  it('persists a NON-uuid entity reference instead of dropping the row', async (t) => {
    if (!dbAvailable) return t.skip('no database');

    // Regression: entity_id is a uuid column, so an order number used to abort
    // the insert. The catch swallowed it and the audit row vanished silently —
    // the audit trail failed exactly for the targets it most needed to record.
    const res = await audit(fakeReq(), {
      action: 'order.status_changed',
      entityType: 'order',
      entityId: 'ZYV-ORD-1001',
    });

    assert.equal(res.ok, true, `audit failed: ${res.error}`);

    const row = await db
      .selectFrom('audit_logs')
      .selectAll()
      .where('id', '=', res.id!)
      .executeTakeFirstOrThrow();

    assert.equal(row.entity_id, null, 'non-uuid cannot go in a uuid column');
    assert.equal(
      (row.new_values as Record<string, unknown>).entityRef,
      'ZYV-ORD-1001',
      'the reference must be preserved, not discarded',
    );
    assert.equal(row.action, 'order.status_changed');
  });

  it('redacts secrets before they reach the database', async (t) => {
    if (!dbAvailable) return t.skip('no database');

    const res = await audit(fakeReq(), {
      action: 'admin.password_reset',
      entityType: 'user',
      entityId: UUID_B,
      newValues: { email: 'a@b.com', password: 'hunter2', token: 'abc123' },
    });

    const row = await db
      .selectFrom('audit_logs')
      .selectAll()
      .where('id', '=', res.id!)
      .executeTakeFirstOrThrow();

    assert.deepEqual(row.new_values, {
      email: 'a@b.com',
      password: '[REDACTED]',
      token: '[REDACTED]',
    });
    const stored = JSON.stringify(row);
    assert.ok(
      !stored.includes('hunter2'),
      'plaintext password reached the table',
    );
  });

  it('truncates values that would overflow their column', async (t) => {
    if (!dbAvailable) return t.skip('no database');

    const res = await audit(fakeReq({ ip: '::ffff:127.0.0.1' }), {
      action: 'x'.repeat(300),
      entityType: 'y'.repeat(300),
      entityId: UUID_A,
    });

    assert.equal(res.ok, true, `audit failed: ${res.error}`);
    const row = await db
      .selectFrom('audit_logs')
      .select(['action', 'entity_type'])
      .where('id', '=', res.id!)
      .executeTakeFirstOrThrow();

    assert.equal(row.action.length, 100);
    assert.equal(row.entity_type.length, 100);
  });
});

describe('ZYV-31 auditAdmin middleware end to end', () => {
  let client: TestClient;

  // A representative admin mutation, mounted exactly as E10 routes will be:
  // behind auth, behind the role check, with audit applied at the boundary.
  function adminApp() {
    const app = express();
    app.use(express.json());

    // Stand in for requireAuth until E6 provides real sessions.
    app.use((req, _res, next) => {
      const role = req.get('x-test-role');
      if (role) {
        req.user = {
          id: UUID_A,
          email: 'admin@example.com',
          fullName: 'Admin',
          mobile: null,
          role: role as 'admin' | 'customer',
        };
      }
      next();
    });

    app.use(
      '/api/admin',
      requireRole('admin'),
      auditAdmin('product'),
      expressRouter(),
    );

    app.use(notFoundHandler());
    app.use(errorHandler);
    return app;
  }

  function expressRouter() {
    const r = express.Router();
    r.patch(
      '/products/:id',
      validate({
        body: z.object({ price: z.number().int().positive() }),
        params: z.object({ id: z.string().uuid() }),
      }),
      asyncHandler(async (req, res) => {
        const { price } = valid<{ price: number }>(req, 'body');
        res.json({ data: { id: req.params.id, price } });
      }),
    );
    return r;
  }

  before(async () => {
    client = await startServer(adminApp());
  });
  after(async () => {
    await client.close();
  });

  it('emits an audit row for a successful admin mutation', async (t) => {
    if (!dbAvailable) return t.skip('no database');

    const before_ = await db
      .selectFrom('audit_logs')
      .select('id')
      .executeTakeFirstOrThrow();

    const res = await getJson(client, '/api/admin/products/' + UUID_A, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        'user-agent': AUDIT_TEST_UA,
        'x-test-role': 'admin',
      },
      body: JSON.stringify({ price: 2999 }),
    });
    assert.equal(res.status, 200);

    await settle();

    const row = await db
      .selectFrom('audit_logs')
      .selectAll()
      .where('id', '!=', before_.id)
      .orderBy('created_at', 'desc')
      .executeTakeFirst();

    assert.ok(row, 'no audit row was written for an admin mutation');
    // The action must be stable across resources, otherwise filtering the log
    // by action is impossible.
    assert.equal(row.action, 'admin.patch.product');
    assert.equal(row.entity_type, 'product');
    assert.equal(row.entity_id, UUID_A);
    assert.deepEqual(row.new_values, { price: 2999 });
    assert.equal(row.user_id, UUID_A, 'actor must be recorded');
  });

  it('does NOT emit an audit row for a rejected mutation', async (t) => {
    if (!dbAvailable) return t.skip('no database');

    const countBefore = (
      await db.selectFrom('audit_logs').select('id').execute()
    ).length;

    // Fails validation, so nothing changed — there is nothing to audit.
    const res = await getJson(client, '/api/admin/products/' + UUID_A, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        'user-agent': AUDIT_TEST_UA,
        'x-test-role': 'admin',
      },
      body: JSON.stringify({ price: -5 }),
    });
    assert.equal(res.status, 400);

    await settle();

    const countAfter = (
      await db.selectFrom('audit_logs').select('id').execute()
    ).length;
    assert.equal(countAfter, countBefore, 'a failed mutation was audited');
  });

  it('does NOT emit an audit row for a blocked customer', async (t) => {
    if (!dbAvailable) return t.skip('no database');

    const countBefore = (
      await db.selectFrom('audit_logs').select('id').execute()
    ).length;

    const res = await getJson(client, '/api/admin/products/' + UUID_A, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        'x-test-role': 'customer',
      },
      body: JSON.stringify({ price: 2999 }),
    });
    assert.equal(res.status, 403);

    await settle();

    const countAfter = (
      await db.selectFrom('audit_logs').select('id').execute()
    ).length;
    assert.equal(countAfter, countBefore, 'a blocked request was audited');
  });
});

describe('ZYV-35 role enforcement on the admin boundary', () => {
  it('rejects an anonymous admin request with 401', async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/admin', requireAdmin, express.Router());
    app.use(notFoundHandler());
    app.use(errorHandler);

    const client = await startServer(app);
    try {
      const res = await getJson(client, '/api/admin/anything');
      assert.equal(res.status, 401);
      assert.equal(res.body.error.code, 'AUTH_REQUIRED');
    } finally {
      await client.close();
    }
  });

  it('rejects a customer with 403', async () => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.user = {
        id: UUID_A,
        email: 'c@example.com',
        fullName: 'C',
        mobile: null,
        role: 'customer',
      };
      next();
    });
    app.use('/api/admin', requireAdmin, express.Router());
    app.use(notFoundHandler());
    app.use(errorHandler);

    const client = await startServer(app);
    try {
      const res = await getJson(client, '/api/admin/anything');
      assert.equal(res.status, 403);
      assert.equal(res.body.error.code, 'FORBIDDEN');
    } finally {
      await client.close();
    }
  });
});
