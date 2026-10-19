import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { createApp } from '../src/app.js';
import { db } from '../src/db/client.js';
import { resetRateLimits } from '../src/http/rate-limit.js';
import { hashPassword } from '../src/auth/password.js';
import { CSRF_HEADER } from '../src/auth/session.js';
import { startServer, type TestClient } from './helpers.js';

const PASSWORD = 'correct horse battery staple';
const ALICE = 'order-alice@example.invalid';
const BOB = 'order-bob@example.invalid';

let client: TestClient;
let aliceId: string;
let bobId: string;
let aliceAddressId: string;
let bobAddressId: string;
let testProductId: string;

const sessions = new Map<
  string,
  { jar: string; token: string; csrfCookie: string }
>();

async function csrf(): Promise<{ token: string; cookie: string }> {
  const res = await fetch(`${client.url}/api/auth/csrf`);
  const cookie = (res.headers.getSetCookie?.() ?? [])
    .filter((c) => c.startsWith('zyvora_csrf='))
    .map((c) => c.split(';')[0])
    .join('; ');
  const token = ((await res.json()) as { data: { csrfToken: string } }).data
    .csrfToken;
  return { token, cookie };
}

interface Call<T = any> {
  status: number;
  body: T;
}

async function call<T = any>(opts: {
  cookie?: string;
  session?: string;
  method?: string;
  path: string;
  body?: unknown;
}): Promise<Call<T>> {
  const method = opts.method ?? 'GET';
  const signedIn = opts.session ? sessions.get(opts.session) : undefined;
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };
  let cookie = signedIn ? signedIn.jar : (opts.cookie ?? '');

  if (method !== 'GET') {
    if (signedIn) {
      headers[CSRF_HEADER] = signedIn.token;
    } else {
      const guest = await csrf();
      headers[CSRF_HEADER] = guest.token;
      cookie = [cookie, guest.cookie].filter(Boolean).join('; ');
    }
  }

  const res = await fetch(`${client.url}${opts.path}`, {
    method,
    headers: { ...headers, ...(cookie ? { cookie } : {}) },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  return {
    status: res.status,
    body: (text ? JSON.parse(text) : null) as T,
  };
}

async function signIn(email: string, pass: string): Promise<string> {
  const { token, cookie } = await csrf();
  const res = await fetch(`${client.url}/api/auth/login`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie,
      [CSRF_HEADER]: token,
    },
    body: JSON.stringify({ identifier: email, password: pass }),
  });
  assert.equal(res.status, 200);
  const setCookies = res.headers.getSetCookie?.() ?? [];
  const jar = setCookies.map((c) => c.split(';')[0]).join('; ');
  const csrfCookie = setCookies.find((c) => c.startsWith('zyvora_csrf='));
  const csrfToken = csrfCookie
    ? csrfCookie.split(';')[0].replace('zyvora_csrf=', '')
    : token;

  sessions.set(email.startsWith('order-alice') ? 'alice' : 'bob', {
    jar,
    token: csrfToken,
    csrfCookie: csrfCookie ?? cookie,
  });
  return jar;
}

describe('E9 Orders and Checkout Integration', () => {
  before(async () => {
    client = await startServer(createApp());

    const customerRole = await db
      .selectFrom('roles')
      .select('id')
      .where('name', '=', 'customer')
      .executeTakeFirstOrThrow();

    const passwordHash = await hashPassword(PASSWORD);

    // Clean up old test data if present
    await db.deleteFrom('order_items').execute();
    await db.deleteFrom('shipments').execute();
    await db.deleteFrom('refunds').execute();
    await db.deleteFrom('payments').execute();
    await db.deleteFrom('orders').execute();
    await db.deleteFrom('cart_items').execute();
    await db.deleteFrom('carts').execute();
    await db.deleteFrom('addresses').execute();
    await db.deleteFrom('users').where('email', 'in', [ALICE, BOB]).execute();

    // Create Alice
    const [alice] = await db
      .insertInto('users')
      .values({
        id: randomUUID(),
        email: ALICE,
        password_hash: passwordHash,
        full_name: 'Alice Sharma',
        mobile: '9876543210',
        role_id: customerRole.id,
      })
      .returningAll()
      .execute();
    aliceId = alice.id;

    // Create Bob
    const [bob] = await db
      .insertInto('users')
      .values({
        id: randomUUID(),
        email: BOB,
        password_hash: passwordHash,
        full_name: 'Bob Verma',
        mobile: '9876543211',
        role_id: customerRole.id,
      })
      .returningAll()
      .execute();
    bobId = bob.id;

    // Create Addresses
    const [aliceAddr] = await db
      .insertInto('addresses')
      .values({
        id: randomUUID(),
        user_id: aliceId,
        full_name: 'Alice Sharma',
        mobile: '9876543210',
        email: ALICE,
        house_number_and_street: '42 Marine Drive',
        area: 'Churchgate',
        city: 'Mumbai',
        state: 'Maharashtra',
        pin_code: '400020',
        country: 'India',
        is_default: true,
      })
      .returningAll()
      .execute();
    aliceAddressId = aliceAddr.id;

    const [bobAddr] = await db
      .insertInto('addresses')
      .values({
        id: randomUUID(),
        user_id: bobId,
        full_name: 'Bob Verma',
        mobile: '9876543211',
        email: BOB,
        house_number_and_street: '15 MG Road',
        area: 'Indiranagar',
        city: 'Bengaluru',
        state: 'Karnataka',
        pin_code: '560038',
        country: 'India',
        is_default: true,
      })
      .returningAll()
      .execute();
    bobAddressId = bobAddr.id;

    // Fetch an active product
    const product = await db
      .selectFrom('products')
      .select(['id', 'price'])
      .where('is_active', '=', true)
      .limit(1)
      .executeTakeFirstOrThrow();
    testProductId = product.id;

    // Ensure inventory is sufficient
    await db
      .updateTable('inventory')
      .set({ quantity: 100, reserved_quantity: 0 })
      .where('product_id', '=', testProductId)
      .execute();

    // Sign in both users
    await signIn(ALICE, PASSWORD);
    await signIn(BOB, PASSWORD);
  });

  after(async () => {
    await client.close();
  });

  beforeEach(() => {
    resetRateLimits();
  });

  describe('ZYV-61 POST /api/orders (Create Order)', () => {
    it('requires authentication (401 for anonymous callers)', async () => {
      const res = await call({
        method: 'POST',
        path: '/api/orders',
        body: { addressId: aliceAddressId },
      });
      assert.equal(res.status, 401);
    });

    it('rejects order when cart is empty (400)', async () => {
      const res = await call({
        session: 'alice',
        method: 'POST',
        path: '/api/orders',
        body: { addressId: aliceAddressId },
      });
      assert.equal(res.status, 400);
      assert.match(res.body.error.message, /empty/i);
    });

    it("rejects order using another user's address (404)", async () => {
      // Put item in Alice's cart
      await call({
        session: 'alice',
        method: 'POST',
        path: '/api/cart/items',
        body: { productId: testProductId, quantity: 1 },
      });

      // Try using Bob's address
      const res = await call({
        session: 'alice',
        method: 'POST',
        path: '/api/orders',
        body: { addressId: bobAddressId },
      });
      assert.equal(res.status, 404);
    });

    it('successfully creates order with stock reservation, clears cart, and creates payment', async () => {
      await db.deleteFrom('cart_items').execute();

      // Check inventory before
      const invBefore = await db
        .selectFrom('inventory')
        .select(['quantity', 'reserved_quantity'])
        .where('product_id', '=', testProductId)
        .executeTakeFirstOrThrow();

      // Alice orders 2 flags
      await call({
        session: 'alice',
        method: 'POST',
        path: '/api/cart/items',
        body: { productId: testProductId, quantity: 2 },
      });

      const res = await call({
        session: 'alice',
        method: 'POST',
        path: '/api/orders',
        body: { addressId: aliceAddressId },
      });

      assert.equal(res.status, 201);
      assert.ok(res.body.data.order.id);
      assert.equal(res.body.data.order.status, 'pending');
      assert.equal(res.body.data.items.length, 1);
      assert.equal(res.body.data.items[0].quantity, 2);
      assert.equal(
        res.body.data.order.shippingAddress.houseNumberAndStreet,
        '42 Marine Drive',
      );

      // Verify inventory reserved atomically
      const invAfter = await db
        .selectFrom('inventory')
        .select(['quantity', 'reserved_quantity'])
        .where('product_id', '=', testProductId)
        .executeTakeFirstOrThrow();

      assert.equal(invAfter.reserved_quantity, invBefore.reserved_quantity + 2);

      // Verify cart was cleared
      const cartRes = await call({
        session: 'alice',
        method: 'GET',
        path: '/api/cart',
      });
      assert.equal(cartRes.body.data.lines.length, 0);

      // Verify pending payment record
      const payment = await db
        .selectFrom('payments')
        .selectAll()
        .where('order_id', '=', res.body.data.order.id)
        .executeTakeFirst();
      assert.ok(payment);
      assert.equal(payment.status, 'pending');
    });

    it('returns existing order idempotently when checkoutSessionId is reused', async () => {
      const sessionId = randomUUID();

      await call({
        session: 'alice',
        method: 'POST',
        path: '/api/cart/items',
        body: { productId: testProductId, quantity: 1 },
      });

      const first = await call({
        session: 'alice',
        method: 'POST',
        path: '/api/orders',
        body: { addressId: aliceAddressId, checkoutSessionId: sessionId },
      });
      assert.equal(first.status, 201);

      // Call again with same session id
      const second = await call({
        session: 'alice',
        method: 'POST',
        path: '/api/orders',
        body: { addressId: aliceAddressId, checkoutSessionId: sessionId },
      });
      assert.equal(second.status, 200);
      assert.equal(second.body.data.order.id, first.body.data.order.id);
      assert.equal(second.body.data.isDuplicate, true);
    });
  });

  describe('ZYV-77 GET /api/orders & GET /api/orders/:id', () => {
    it('customer only sees their own orders', async () => {
      const aliceOrders = await call({
        session: 'alice',
        method: 'GET',
        path: '/api/orders',
      });
      assert.equal(aliceOrders.status, 200);
      assert.ok(aliceOrders.body.data.length >= 1);

      const bobOrders = await call({
        session: 'bob',
        method: 'GET',
        path: '/api/orders',
      });
      assert.equal(bobOrders.status, 200);
      assert.equal(bobOrders.body.data.length, 0);
    });

    it("cannot fetch another customer's order by ID (404)", async () => {
      const aliceOrders = await call({
        session: 'alice',
        method: 'GET',
        path: '/api/orders',
      });
      const orderId = aliceOrders.body.data[0].id;

      // Bob tries to view Alice's order
      const res = await call({
        session: 'bob',
        method: 'GET',
        path: `/api/orders/${orderId}`,
      });
      assert.equal(res.status, 404);

      // Alice can view her own order
      const aliceRes = await call({
        session: 'alice',
        method: 'GET',
        path: `/api/orders/${orderId}`,
      });
      assert.equal(aliceRes.status, 200);
      assert.equal(aliceRes.body.data.id, orderId);
      assert.ok(aliceRes.body.data.shippingAddress);
    });
  });

  describe('ZYV-89 Order Cancellation Policy', () => {
    it('cancels pending order and releases reserved inventory', async () => {
      // Put item in Alice cart and order
      await call({
        session: 'alice',
        method: 'POST',
        path: '/api/cart/items',
        body: { productId: testProductId, quantity: 3 },
      });

      const orderRes = await call({
        session: 'alice',
        method: 'POST',
        path: '/api/orders',
        body: { addressId: aliceAddressId },
      });
      const orderId = orderRes.body.data.order.id;

      const invBeforeCancel = await db
        .selectFrom('inventory')
        .select('reserved_quantity')
        .where('product_id', '=', testProductId)
        .executeTakeFirstOrThrow();

      // Cancel order
      const cancelRes = await call({
        session: 'alice',
        method: 'POST',
        path: `/api/orders/${orderId}/cancel`,
        body: { reason: 'Changed my mind' },
      });

      assert.equal(cancelRes.status, 200);
      assert.equal(cancelRes.body.data.order.status, 'cancelled');
      assert.equal(cancelRes.body.data.order.cancel_reason, 'Changed my mind');

      // Reserved stock must decrease by 3
      const invAfterCancel = await db
        .selectFrom('inventory')
        .select('reserved_quantity')
        .where('product_id', '=', testProductId)
        .executeTakeFirstOrThrow();

      assert.equal(
        invAfterCancel.reserved_quantity,
        invBeforeCancel.reserved_quantity - 3,
      );
    });

    it('rejects cancellation for shipped or delivered orders (400)', async () => {
      // Create order and artificially mark as delivered
      await call({
        session: 'alice',
        method: 'POST',
        path: '/api/cart/items',
        body: { productId: testProductId, quantity: 1 },
      });
      const ord = await call({
        session: 'alice',
        method: 'POST',
        path: '/api/orders',
        body: { addressId: aliceAddressId },
      });
      const orderId = ord.body.data.order.id;

      await db
        .updateTable('orders')
        .set({ status: 'delivered' })
        .where('id', '=', orderId)
        .execute();

      const cancelRes = await call({
        session: 'alice',
        method: 'POST',
        path: `/api/orders/${orderId}/cancel`,
        body: { reason: 'Too late' },
      });

      assert.equal(cancelRes.status, 400);
      assert.match(cancelRes.body.error.message, /cannot be cancelled/i);
    });
  });

  describe('ZYV-87 Return & Refund Request Policy', () => {
    it('rejects return for non-delivered orders (400)', async () => {
      await call({
        session: 'alice',
        method: 'POST',
        path: '/api/cart/items',
        body: { productId: testProductId, quantity: 1 },
      });
      const ord = await call({
        session: 'alice',
        method: 'POST',
        path: '/api/orders',
        body: { addressId: aliceAddressId },
      });
      const orderId = ord.body.data.order.id;

      const returnRes = await call({
        session: 'alice',
        method: 'POST',
        path: `/api/orders/${orderId}/return`,
        body: { reason: 'Color did not match vehicle' },
      });

      assert.equal(returnRes.status, 400);
      assert.match(returnRes.body.error.message, /delivered/i);
    });

    it('accepts return for delivered orders and creates refund record', async () => {
      await call({
        session: 'alice',
        method: 'POST',
        path: '/api/cart/items',
        body: { productId: testProductId, quantity: 1 },
      });
      const ord = await call({
        session: 'alice',
        method: 'POST',
        path: '/api/orders',
        body: { addressId: aliceAddressId },
      });
      const orderId = ord.body.data.order.id;

      // Mark delivered
      await db
        .updateTable('orders')
        .set({ status: 'delivered' })
        .where('id', '=', orderId)
        .execute();

      const returnRes = await call({
        session: 'alice',
        method: 'POST',
        path: `/api/orders/${orderId}/return`,
        body: { reason: 'Damaged during transit' },
      });

      assert.equal(returnRes.status, 200);
      assert.equal(returnRes.body.data.order.status, 'return_requested');

      // Verify refund row
      const refunds = await db
        .selectFrom('refunds')
        .selectAll()
        .where('reason', '=', 'Damaged during transit')
        .execute();
      assert.equal(refunds.length, 1);
      assert.equal(refunds[0].status, 'pending');
    });
  });

  describe('ZYV-79 Customer Profile & Password Change', () => {
    it('updates customer profile name and mobile', async () => {
      const res = await call({
        session: 'alice',
        method: 'PATCH',
        path: '/api/auth/profile',
        body: { fullName: 'Alice Wonder', mobile: '9988776655' },
      });

      assert.equal(res.status, 200);
      assert.equal(res.body.data.fullName, 'Alice Wonder');
      assert.equal(res.body.data.mobile, '9988776655');

      const user = await db
        .selectFrom('users')
        .select(['full_name', 'mobile'])
        .where('id', '=', aliceId)
        .executeTakeFirstOrThrow();
      assert.equal(user.full_name, 'Alice Wonder');
      assert.equal(user.mobile, '9988776655');
    });

    it('validates mobile number format in profile update (400)', async () => {
      const res = await call({
        session: 'alice',
        method: 'PATCH',
        path: '/api/auth/profile',
        body: { mobile: '123' },
      });
      assert.equal(res.status, 400);
    });

    it('rejects password change with incorrect current password', async () => {
      const res = await call({
        session: 'alice',
        method: 'POST',
        path: '/api/auth/change-password',
        body: {
          currentPassword: 'wrong password here',
          newPassword: 'brand new valid password 1234',
        },
      });
      assert.equal(res.status, 401);
    });

    it('rejects new password if too short or common (400)', async () => {
      const res = await call({
        session: 'alice',
        method: 'POST',
        path: '/api/auth/change-password',
        body: {
          currentPassword: PASSWORD,
          newPassword: 'short',
        },
      });
      assert.equal(res.status, 400);
    });

    it('changes password successfully and allows login with new password', async () => {
      const NEW_PASS = 'brand-new-secret-phrase-77!';
      const res = await call({
        session: 'alice',
        method: 'POST',
        path: '/api/auth/change-password',
        body: {
          currentPassword: PASSWORD,
          newPassword: NEW_PASS,
        },
      });
      assert.equal(res.status, 200);

      // Verify can sign in with new password
      const newJar = await signIn(ALICE, NEW_PASS);
      assert.ok(newJar);
    });
  });
});
