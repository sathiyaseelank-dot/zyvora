import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { createApp } from '../src/app.js';
import { db } from '../src/db/client.js';
import { resetRateLimits } from '../src/http/rate-limit.js';
import { hashPassword } from '../src/auth/password.js';
import { CSRF_HEADER } from '../src/auth/session.js';
import { startServer, type TestClient } from './helpers.js';

/**
 * Address book (ZYV-58) and checkout validation (ZYV-59).
 *
 * The properties worth defending:
 *
 *  - One address belongs to one person. Every read and write is scoped by
 *    `user_id` in the WHERE clause, so another account's address is
 *    indistinguishable from one that does not exist.
 *  - There is always exactly one default. Enforced by a partial unique index,
 *    not by this code — the tests only confirm the constraint bites.
 *  - Checkout computes nothing the client can dictate, and creates nothing.
 */

const PASSWORD = 'correct horse battery staple';
const ALICE = 'e7-alice@example.invalid';
const BOB = 'e7-bob@example.invalid';

let client: TestClient;

const ADDRESS = {
  fullName: 'Alice Sharma',
  mobile: '9812345678',
  email: 'alice@example.invalid',
  houseNumberAndStreet: '12B, Rose Villa',
  area: 'Bandra West',
  landmark: 'Opposite the temple',
  city: 'Mumbai',
  state: 'Maharashtra',
  pinCode: '400050',
  deliveryInstructions: 'Leave with the watchman',
};

interface AddressWire {
  id: string;
  fullName: string;
  isDefault: boolean;
  pinCode: string;
}

/** One signed-in client per account, keyed by a plain object so tokens cache. */
const sessions = new Map<
  string,
  { jar: string; token: string; csrfCookie: string }
>();

/**
 * Fetch a CSRF token AND the cookie that must accompany it.
 *
 * The guard is double-submit: the server compares the readable `zyvora_csrf`
 * cookie against the `x-csrf-token` header. Returning only the token and
 * dropping the cookie is what made every sign-in 403 - and because the helper
 * runs in `before`, that fixture failure took all 22 tests down with it.
 */
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

interface Call<T> {
  status: number;
  body: T;
}

async function call<T>(opts: {
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
      // Guest callers need a CSRF cookie AND its matching header. Fetching
      // only the token is what made every signed-in call 403 earlier.
      const guest = await csrf();
      headers[CSRF_HEADER] = guest.token;
      // MERGED, not replaced. A guest cart test arrives carrying
      // `zyvora_cart=...`; overwriting `cookie` with the CSRF cookie alone
      // threw that away and the request went out with no basket.
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

async function createUser(email: string, mobile: string): Promise<void> {
  await db.deleteFrom('users').where('email', '=', email).execute();
  const role = await db
    .selectFrom('roles')
    .select('id')
    .where('name', '=', 'customer')
    .executeTakeFirstOrThrow();
  await db
    .insertInto('users')
    .values({
      email,
      password_hash: await hashPassword(PASSWORD),
      full_name: email.split('@')[0],
      mobile,
      role_id: role.id,
    })
    .execute();
}

/** Sign in and keep the session cookie plus a cached CSRF token. */
async function signIn(key: string, email: string): Promise<void> {
  const first = await csrf();
  const res = await fetch(`${client.url}/api/auth/login`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: first.cookie,
      [CSRF_HEADER]: first.token,
    },
    body: JSON.stringify({ identifier: email, password: PASSWORD }),
  });
  assert.equal(res.status, 200, `fixture sign-in for ${email} must succeed`);

  // Keep every cookie login set, then take a fresh CSRF pair: signing in
  // rotates the token, so the one used to log in is now stale.
  const jar = [
    ...first.cookie.split('; ').filter(Boolean),
    ...(res.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]),
  ]
    .filter((v, i, a) => a.indexOf(v) === i)
    .join('; ');

  const fresh = await csrf();
  sessions.set(key, { jar, token: fresh.token, csrfCookie: fresh.cookie });
}

before(async () => {
  client = await startServer(createApp());
  await createUser(ALICE, '9700000011');
  await createUser(BOB, '9700000012');
  await signIn('alice', ALICE);
  await signIn('bob', BOB);
});

after(async () => {
  const rows = await db
    .selectFrom('users')
    .select('id')
    .where('email', 'in', [ALICE, BOB])
    .execute();
  for (const u of rows) {
    await db.deleteFrom('addresses').where('user_id', '=', u.id).execute();
    await db.deleteFrom('carts').where('user_id', '=', u.id).execute();
  }
  await db.deleteFrom('users').where('email', 'in', [ALICE, BOB]).execute();
  await client.close();
  await db.destroy();
});

beforeEach(() => {
  resetRateLimits();
  // Each test starts from an empty address book so default-address rules are
  // not decided by whatever a previous test left behind.
  return Promise.all(
    [...sessions.keys()].map(async (k) => {
      const row = await db
        .selectFrom('users')
        .select('id')
        .where('email', '=', k === 'alice' ? ALICE : BOB)
        .executeTakeFirstOrThrow();
      await db.deleteFrom('addresses').where('user_id', '=', row.id).execute();
      // Carts too. `resolveCart` picks one cart per account with no ordering,
      // so a cart left behind by an earlier test would be validated instead of
      // the one this test just built - which is exactly how an over-stock
      // basket came back `canCheckout: true`.
      await db.deleteFrom('carts').where('user_id', '=', row.id).execute();
    }),
  );
});

describe('ZYV-58 create and read addresses', () => {
  it('creates an address and returns it in camelCase', async () => {
    const res = await call<{ data: AddressWire }>({
      session: 'alice',
      method: 'POST',
      path: '/api/addresses',
      body: ADDRESS,
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.data.fullName, ADDRESS.fullName);
    assert.equal(res.body.data.pinCode, ADDRESS.pinCode);
    // snake_case must never reach the client
    assert.equal(
      (res.body.data as unknown as Record<string, unknown>).full_name,
      undefined,
    );
  });

  it('makes the first address the default without being asked', async () => {
    // An address book where nothing is default makes checkout ask "which one?"
    // every single time.
    const res = await call<{ data: AddressWire }>({
      session: 'alice',
      method: 'POST',
      path: '/api/addresses',
      body: ADDRESS,
    });
    assert.equal(res.body.data.isDefault, true);
  });

  it("lists only the caller's addresses", async () => {
    await call({
      session: 'alice',
      method: 'POST',
      path: '/api/addresses',
      body: ADDRESS,
    });
    await call({
      session: 'bob',
      method: 'POST',
      path: '/api/addresses',
      body: { ...ADDRESS, fullName: 'Bob Rao' },
    });

    const alice = await call<{ data: AddressWire[] }>({
      session: 'alice',
      path: '/api/addresses',
    });
    assert.equal(alice.body.data.length, 1);
    assert.equal(alice.body.data[0].fullName, 'Alice Sharma');
  });

  it('refuses an anonymous caller', async () => {
    // A street, a mobile and a name: there is no guest variant of this API.
    const res = await call({ method: 'GET', path: '/api/addresses' });
    assert.equal(res.status, 401);
  });

  it('rejects a malformed address with a field-level message', async () => {
    const res = await call<{
      error: {
        code: string;
        details?: { fieldErrors?: Record<string, string[]> };
      };
    }>({
      session: 'alice',
      method: 'POST',
      path: '/api/addresses',
      body: { ...ADDRESS, mobile: '123', pinCode: '40' },
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
    assert.ok(res.body.error.details?.fieldErrors?.['body.mobile']);
    assert.ok(res.body.error.details?.fieldErrors?.['body.pinCode']);
  });

  it('caps how many addresses one person can save', async () => {
    for (let i = 0; i < 10; i++) {
      const r = await call({
        session: 'alice',
        method: 'POST',
        path: '/api/addresses',
        body: { ...ADDRESS, houseNumberAndStreet: `House ${i}` },
      });
      assert.equal(r.status, 201);
    }
    const overflow = await call<{ error: { message: string } }>({
      session: 'alice',
      method: 'POST',
      path: '/api/addresses',
      body: { ...ADDRESS, houseNumberAndStreet: 'One too many' },
    });
    assert.equal(overflow.status, 400);
    assert.match(overflow.body.error.message, /at most 10/i);
  });
});

describe('ZYV-58 the default address', () => {
  it('keeps exactly one default when a second address is created', async () => {
    const first = await call<{ data: AddressWire }>({
      session: 'alice',
      method: 'POST',
      path: '/api/addresses',
      body: ADDRESS,
    });
    const second = await call<{ data: AddressWire }>({
      session: 'alice',
      method: 'POST',
      path: '/api/addresses',
      body: { ...ADDRESS, houseNumberAndStreet: '99, Second Street' },
    });

    assert.equal(first.body.data.isDefault, true);
    assert.equal(second.body.data.isDefault, false);

    const list = await call<{ data: AddressWire[] }>({
      session: 'alice',
      path: '/api/addresses',
    });
    assert.equal(
      list.body.data.filter((a) => a.isDefault).length,
      1,
      'exactly one address may be the default',
    );
  });

  it('moves the default when another address is promoted', async () => {
    await call({
      session: 'alice',
      method: 'POST',
      path: '/api/addresses',
      body: ADDRESS,
    });
    const second = await call<{ data: AddressWire }>({
      session: 'alice',
      method: 'POST',
      path: '/api/addresses',
      body: { ...ADDRESS, houseNumberAndStreet: '99, Second Street' },
    });

    await call({
      session: 'alice',
      method: 'PATCH',
      path: `/api/addresses/${second.body.data.id}`,
      body: { isDefault: true },
    });

    const list = await call<{ data: AddressWire[] }>({
      session: 'alice',
      path: '/api/addresses',
    });
    const defaults = list.body.data.filter((a) => a.isDefault);
    assert.equal(defaults.length, 1);
    assert.equal(defaults[0].id, second.body.data.id);
  });

  it('refuses to un-default the only address', async () => {
    // Checkout needs somewhere to deliver. Silently ignoring this would leave
    // the client believing it had changed something.
    const only = await call<{ data: AddressWire }>({
      session: 'alice',
      method: 'POST',
      path: '/api/addresses',
      body: ADDRESS,
    });

    const res = await call<{ error: { message: string } }>({
      session: 'alice',
      method: 'PATCH',
      path: `/api/addresses/${only.body.data.id}`,
      body: { isDefault: false },
    });
    assert.equal(res.status, 400);
    assert.match(res.body.error.message, /only address/i);
  });

  it('promotes another address when the default is deleted', async () => {
    const first = await call<{ data: AddressWire }>({
      session: 'alice',
      method: 'POST',
      path: '/api/addresses',
      body: ADDRESS,
    });
    const second = await call<{ data: AddressWire }>({
      session: 'alice',
      method: 'POST',
      path: '/api/addresses',
      body: { ...ADDRESS, houseNumberAndStreet: '99, Second Street' },
    });

    const del = await call({
      session: 'alice',
      method: 'DELETE',
      path: `/api/addresses/${first.body.data.id}`,
    });
    assert.equal(del.status, 204);

    const list = await call<{ data: AddressWire[] }>({
      session: 'alice',
      path: '/api/addresses',
    });
    assert.equal(list.body.data.length, 1);
    assert.equal(list.body.data[0].id, second.body.data.id);
    assert.equal(
      list.body.data[0].isDefault,
      true,
      'deleting the default must leave someone else holding it',
    );
  });

  it('is enforced by the database, not only by this code', async () => {
    // Two defaults inserted directly, bypassing every handler. Only the
    // partial unique index can stop this, which is the point of having it.
    const user = await db
      .selectFrom('users')
      .select('id')
      .where('email', '=', ALICE)
      .executeTakeFirstOrThrow();

    await db
      .insertInto('addresses')
      .values({ ...rowFor(user.id), is_default: false })
      .execute();
    await db
      .insertInto('addresses')
      .values({ ...rowFor(user.id), is_default: true })
      .execute();

    await assert.rejects(
      () =>
        db
          .insertInto('addresses')
          .values({ ...rowFor(user.id), is_default: true })
          .execute(),
      /addresses_one_default_per_user|duplicate key/i,
      'the database must refuse a second default address',
    );
  });
});

function rowFor(userId: string) {
  return {
    id: randomUUID(),
    user_id: userId,
    full_name: 'Direct Write',
    mobile: '9812000000',
    email: 'direct@example.invalid',
    house_number_and_street: '1 Direct Row',
    area: 'Somewhere',
    city: 'Pune',
    state: 'Maharashtra',
    pin_code: '411001',
    country: 'India',
    is_default: false,
    created_at: new Date(),
  };
}

describe('ZYV-58 ownership', () => {
  it("cannot read another account's address", async () => {
    const alice = await call<{ data: AddressWire }>({
      session: 'alice',
      method: 'POST',
      path: '/api/addresses',
      body: ADDRESS,
    });

    const res = await call<{ error: { code: string } }>({
      session: 'bob',
      path: `/api/addresses/${alice.body.data.id}`,
    });
    // 404, not 403: "forbidden" would confirm the id exists.
    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'NOT_FOUND');
  });

  it("cannot change another account's address", async () => {
    const alice = await call<{ data: AddressWire }>({
      session: 'alice',
      method: 'POST',
      path: '/api/addresses',
      body: ADDRESS,
    });

    const res = await call({
      session: 'bob',
      method: 'PATCH',
      path: `/api/addresses/${alice.body.data.id}`,
      body: { city: 'Hijacked' },
    });
    assert.equal(res.status, 404);

    const check = await call<{ data: AddressWire }>({
      session: 'alice',
      path: `/api/addresses/${alice.body.data.id}`,
    });
    assert.equal(check.status, 200);
  });

  it("cannot delete another account's address", async () => {
    const alice = await call<{ data: AddressWire }>({
      session: 'alice',
      method: 'POST',
      path: '/api/addresses',
      body: ADDRESS,
    });
    const before_ = await call<{ data: AddressWire[] }>({
      session: 'alice',
      path: '/api/addresses',
    });

    const res = await call({
      session: 'bob',
      method: 'DELETE',
      path: `/api/addresses/${alice.body.data.id}`,
    });
    assert.equal(res.status, 404);

    const after_ = await call<{ data: AddressWire[] }>({
      session: 'alice',
      path: '/api/addresses',
    });
    assert.equal(after_.body.data.length, before_.body.data.length);
  });
});

describe('ZYV-59 checkout validation', () => {
  interface ValidateBody {
    data: {
      canCheckout: boolean;
      blockers: { code: string; message: string }[];
      totals: null | {
        subtotal: number;
        shipping: number;
        discount: number;
        total: number;
        itemCount: number;
      };
      lines: { productId: string; quantity: number; lineTotal: number }[];
      address: { id: string } | null;
    };
  }

  it('refuses an empty basket with a stated reason', async () => {
    const res = await call<ValidateBody>({
      session: 'alice',
      method: 'POST',
      path: '/api/checkout/validate',
      body: {},
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.canCheckout, false);
    assert.equal(res.body.data.blockers[0].code, 'EMPTY_CART');
    assert.equal(res.body.data.totals, null);
  });

  it('prices a real basket from the database', async () => {
    const product = await db
      .selectFrom('products')
      .innerJoin('inventory', 'inventory.product_id', 'products.id')
      .select(['products.id', 'products.price'])
      .where('products.is_active', '=', true)
      .limit(1)
      .executeTakeFirstOrThrow();

    const cart = await db
      .insertInto('carts')
      .values({ id: randomUUID() })
      .returning('id')
      .executeTakeFirstOrThrow();
    const user = await db
      .selectFrom('users')
      .select('id')
      .where('email', '=', ALICE)
      .executeTakeFirstOrThrow();
    await db
      .updateTable('carts')
      .set({ user_id: user.id })
      .where('id', '=', cart.id)
      .execute();
    await db
      .insertInto('cart_items')
      .values({
        id: randomUUID(),
        cart_id: cart.id,
        product_id: product.id,
        quantity: 2,
      })
      .execute();

    const res = await call<ValidateBody>({
      session: 'alice',
      method: 'POST',
      path: '/api/checkout/validate',
      body: {},
    });

    assert.equal(res.body.data.canCheckout, true);
    assert.equal(res.body.data.totals?.subtotal, product.price * 2);
    assert.equal(res.body.data.lines[0].lineTotal, product.price * 2);
    assert.equal(
      res.body.data.totals?.total,
      (res.body.data.totals?.subtotal ?? 0) +
        (res.body.data.totals?.shipping ?? 0),
    );
  });

  it('blocks a basket holding more than is in stock', async () => {
    const product = await db
      .selectFrom('products')
      .innerJoin('inventory', 'inventory.product_id', 'products.id')
      .select(['products.id', 'inventory.quantity'])
      .where('products.is_active', '=', true)
      .limit(1)
      .executeTakeFirstOrThrow();

    const user = await db
      .selectFrom('users')
      .select('id')
      .where('email', '=', ALICE)
      .executeTakeFirstOrThrow();
    const cart = await db
      .insertInto('carts')
      .values({ id: randomUUID(), user_id: user.id })
      .returning('id')
      .executeTakeFirstOrThrow();
    await db
      .insertInto('cart_items')
      .values({
        id: randomUUID(),
        cart_id: cart.id,
        product_id: product.id,
        quantity: product.quantity + 5,
      })
      .execute();

    const res = await call<ValidateBody>({
      session: 'alice',
      method: 'POST',
      path: '/api/checkout/validate',
      body: {},
    });
    assert.equal(res.body.data.canCheckout, false);
    assert.ok(
      res.body.data.blockers.some((b) => b.code === 'INSUFFICIENT_STOCK'),
      'over-stock must block checkout',
    );
  });

  it('blocks a basket holding a withdrawn product', async () => {
    const product = await db
      .selectFrom('products')
      .select('id')
      .where('is_active', '=', true)
      .limit(1)
      .executeTakeFirstOrThrow();
    const user = await db
      .selectFrom('users')
      .select('id')
      .where('email', '=', ALICE)
      .executeTakeFirstOrThrow();
    const cart = await db
      .insertInto('carts')
      .values({ id: randomUUID(), user_id: user.id })
      .returning('id')
      .executeTakeFirstOrThrow();
    await db
      .insertInto('cart_items')
      .values({
        id: randomUUID(),
        cart_id: cart.id,
        product_id: product.id,
        quantity: 1,
      })
      .execute();
    await db
      .updateTable('products')
      .set({ is_active: false })
      .where('id', '=', product.id)
      .execute();

    try {
      const res = await call<ValidateBody>({
        session: 'alice',
        method: 'POST',
        path: '/api/checkout/validate',
        body: {},
      });
      assert.equal(res.body.data.canCheckout, false);
      assert.ok(
        res.body.data.blockers.some((b) => b.code === 'PRODUCT_UNAVAILABLE'),
      );
    } finally {
      await db
        .updateTable('products')
        .set({ is_active: true })
        .where('id', '=', product.id)
        .execute();
    }
  });

  it('attaches a delivery address the caller owns', async () => {
    const product = await db
      .selectFrom('products')
      .select('id')
      .where('is_active', '=', true)
      .limit(1)
      .executeTakeFirstOrThrow();
    const user = await db
      .selectFrom('users')
      .select('id')
      .where('email', '=', ALICE)
      .executeTakeFirstOrThrow();
    const cart = await db
      .insertInto('carts')
      .values({ id: randomUUID(), user_id: user.id })
      .returning('id')
      .executeTakeFirstOrThrow();
    await db
      .insertInto('cart_items')
      .values({
        id: randomUUID(),
        cart_id: cart.id,
        product_id: product.id,
        quantity: 1,
      })
      .execute();
    const address = await call<{ data: AddressWire }>({
      session: 'alice',
      method: 'POST',
      path: '/api/addresses',
      body: ADDRESS,
    });

    const res = await call<ValidateBody>({
      session: 'alice',
      method: 'POST',
      path: '/api/checkout/validate',
      body: { addressId: address.body.data.id },
    });
    assert.equal(res.body.data.canCheckout, true);
    assert.equal(res.body.data.address?.id, address.body.data.id);
  });

  it("will not attach another account's address", async () => {
    const product = await db
      .selectFrom('products')
      .select('id')
      .where('is_active', '=', true)
      .limit(1)
      .executeTakeFirstOrThrow();
    const user = await db
      .selectFrom('users')
      .select('id')
      .where('email', '=', ALICE)
      .executeTakeFirstOrThrow();
    const cart = await db
      .insertInto('carts')
      .values({ id: randomUUID(), user_id: user.id })
      .returning('id')
      .executeTakeFirstOrThrow();
    await db
      .insertInto('cart_items')
      .values({
        id: randomUUID(),
        cart_id: cart.id,
        product_id: product.id,
        quantity: 1,
      })
      .execute();

    const bobAddress = await call<{ data: AddressWire }>({
      session: 'bob',
      method: 'POST',
      path: '/api/addresses',
      body: { ...ADDRESS, fullName: 'Bob Rao' },
    });

    const res = await call<ValidateBody>({
      session: 'alice',
      method: 'POST',
      path: '/api/checkout/validate',
      body: { addressId: bobAddress.body.data.id },
    });
    assert.equal(res.body.data.canCheckout, false);
    assert.equal(res.body.data.address, null);
    assert.ok(
      res.body.data.blockers.some((b) => b.code === 'ADDRESS_NOT_FOUND'),
    );
  });

  it('prices for a guest, and says why an address will not apply', async () => {
    // Guests must be able to see a total and shipping before being made to
    // sign in. Silently ignoring the address would leave the client guessing.
    const product = await db
      .selectFrom('products')
      .select('id')
      .where('is_active', '=', true)
      .limit(1)
      .executeTakeFirstOrThrow();

    const guestSession = randomUUID();
    const cart = await db
      .insertInto('carts')
      .values({ id: randomUUID(), session_id: guestSession })
      .returning('id')
      .executeTakeFirstOrThrow();
    await db
      .insertInto('cart_items')
      .values({
        id: randomUUID(),
        cart_id: cart.id,
        product_id: product.id,
        quantity: 1,
      })
      .execute();

    const res = await call<ValidateBody>({
      cookie: `zyvora_cart=${guestSession}`,
      method: 'POST',
      path: '/api/checkout/validate',
      body: {},
    });
    assert.equal(res.body.data.canCheckout, true);
    assert.ok((res.body.data.totals?.subtotal ?? 0) > 0);
    assert.equal(res.body.data.address, null);
  });

  it('charges no shipping once the basket clears the threshold', async () => {
    // The checkout total is computed independently of the cart total, so the
    // cart's coverage of this does not carry over. Without it, removing the
    // threshold check left every checkout test green while a Rs 2,500 basket
    // was charged the flat rate.
    const product = await db
      .selectFrom('products')
      .select(['id', 'price'])
      .where('is_active', '=', true)
      .orderBy('price', 'desc')
      .limit(1)
      .executeTakeFirstOrThrow();
    assert.ok(
      product.price * 2 >= 2000,
      'fixture needs two units to reach the threshold',
    );

    const user = await db
      .selectFrom('users')
      .select('id')
      .where('email', '=', ALICE)
      .executeTakeFirstOrThrow();
    const cart = await db
      .insertInto('carts')
      .values({ id: randomUUID(), user_id: user.id })
      .returning('id')
      .executeTakeFirstOrThrow();
    await db
      .insertInto('cart_items')
      .values({
        id: randomUUID(),
        cart_id: cart.id,
        product_id: product.id,
        quantity: 2,
      })
      .execute();

    const res = await call<ValidateBody>({
      session: 'alice',
      method: 'POST',
      path: '/api/checkout/validate',
      body: {},
    });
    assert.equal(res.body.data.totals?.subtotal, product.price * 2);
    assert.ok((res.body.data.totals?.subtotal ?? 0) >= 2000);
    assert.equal(
      res.body.data.totals?.shipping,
      0,
      'shipping is free past 2000',
    );
    assert.equal(res.body.data.totals?.amountToFreeShipping, 0);
  });

  it('charges the flat rate just below the threshold', async () => {
    const product = await db
      .selectFrom('products')
      .select(['id', 'price'])
      .where('is_active', '=', true)
      .orderBy('price', 'asc')
      .limit(1)
      .executeTakeFirstOrThrow();
    assert.ok(product.price < 2000, 'fixture must start under the threshold');

    const user = await db
      .selectFrom('users')
      .select('id')
      .where('email', '=', ALICE)
      .executeTakeFirstOrThrow();
    const cart = await db
      .insertInto('carts')
      .values({ id: randomUUID(), user_id: user.id })
      .returning('id')
      .executeTakeFirstOrThrow();
    await db
      .insertInto('cart_items')
      .values({
        id: randomUUID(),
        cart_id: cart.id,
        product_id: product.id,
        quantity: 1,
      })
      .execute();

    const res = await call<ValidateBody>({
      session: 'alice',
      method: 'POST',
      path: '/api/checkout/validate',
      body: {},
    });
    assert.equal(res.body.data.totals?.shipping, 99);
    assert.ok((res.body.data.totals?.amountToFreeShipping ?? 0) > 0);
  });

  describe('coupons', () => {
    /** One basket worth roughly Rs 1,000, for coupon arithmetic. */
    async function basket(): Promise<void> {
      const product = await db
        .selectFrom('products')
        .select(['id', 'price'])
        .where('is_active', '=', true)
        .orderBy('price', 'desc')
        .limit(1)
        .executeTakeFirstOrThrow();
      const user = await db
        .selectFrom('users')
        .select('id')
        .where('email', '=', ALICE)
        .executeTakeFirstOrThrow();
      const cart = await db
        .insertInto('carts')
        .values({ id: randomUUID(), user_id: user.id })
        .returning('id')
        .executeTakeFirstOrThrow();
      await db
        .insertInto('cart_items')
        .values({
          id: randomUUID(),
          cart_id: cart.id,
          product_id: product.id,
          quantity: 1,
        })
        .execute();
    }

    async function coupon(
      over: Partial<{
        code: string;
        discount_type: string;
        discount_value: number;
        min_order_amount: number | null;
        max_discount: number | null;
        usage_limit: number | null;
        used_count: number;
        expires_at: Date | null;
        is_active: boolean;
      }>,
    ) {
      const row = {
        id: randomUUID(),
        code: `T${randomUUID().slice(0, 8).toUpperCase()}`,
        discount_type: 'percentage',
        discount_value: 10,
        min_order_amount: null,
        max_discount: null,
        usage_limit: null,
        used_count: 0,
        starts_at: new Date(Date.now() - 86_400_000),
        expires_at: new Date(Date.now() + 86_400_000),
        is_active: true,
        ...over,
      };
      await db.insertInto('coupons').values(row).execute();
      return row;
    }

    const validate = (couponCode: string) =>
      call<{
        data: {
          canCheckout: boolean;
          totals: {
            subtotal: number;
            shipping: number;
            discount: number;
            total: number;
          };
          coupon: { applied: boolean; rejected: string | null };
        };
      }>({
        session: 'alice',
        method: 'POST',
        path: '/api/checkout/validate',
        body: { couponCode },
      });

    it('applies a percentage coupon', async () => {
      await basket();
      const c = await coupon({
        discount_type: 'percentage',
        discount_value: 10,
      });
      const res = await validate(c.code);
      const expected = Math.floor((res.body.data.totals.subtotal * 10) / 100);
      assert.equal(res.body.data.totals.discount, expected);
      assert.equal(res.body.data.coupon.applied, true);
      assert.equal(
        res.body.data.totals.total,
        res.body.data.totals.subtotal -
          expected +
          res.body.data.totals.shipping,
        'total must equal subtotal - discount + shipping',
      );
      assert.equal(
        res.body.data.canCheckout,
        true,
        'a coupon never blocks checkout',
      );
    });

    it('caps a percentage discount at max_discount', async () => {
      await basket();
      const c = await coupon({
        discount_type: 'percentage',
        discount_value: 90,
        max_discount: 50,
      });
      const res = await validate(c.code);
      assert.equal(res.body.data.totals.discount, 50);
    });

    it('applies a flat-amount coupon', async () => {
      await basket();
      const c = await coupon({ discount_type: 'fixed', discount_value: 75 });
      const res = await validate(c.code);
      assert.equal(res.body.data.totals.discount, 75);
    });

    it('never lets a discount exceed the subtotal', async () => {
      // A Rs 5,000 coupon on a Rs 199 basket. Unclamped, the "discount" would
      // be a payment error, and a total would go negative.
      await basket();
      const c = await coupon({ discount_type: 'fixed', discount_value: 5000 });
      const res = await validate(c.code);
      assert.ok(
        res.body.data.totals.discount <= res.body.data.totals.subtotal,
        'discount must not exceed the subtotal',
      );
      assert.ok(
        res.body.data.totals.total >= 0,
        'total must never go negative',
      );
    });

    it('rejects a coupon that has expired', async () => {
      await basket();
      const c = await coupon({ expires_at: new Date(Date.now() - 1000) });
      const res = await validate(c.code);
      assert.equal(res.body.data.totals.discount, 0);
      assert.ok(res.body.data.coupon.rejected);
    });

    it('rejects an inactive coupon', async () => {
      await basket();
      const c = await coupon({ is_active: false });
      const res = await validate(c.code);
      assert.equal(res.body.data.totals.discount, 0);
      assert.ok(res.body.data.coupon.rejected);
    });

    it('rejects a coupon whose minimum order is not met', async () => {
      await basket();
      const c = await coupon({ min_order_amount: 9_999_999 });
      const res = await validate(c.code);
      assert.equal(res.body.data.totals.discount, 0);
      assert.ok(res.body.data.coupon.rejected);
    });

    it('rejects an exhausted coupon', async () => {
      await basket();
      const c = await coupon({ usage_limit: 5, used_count: 5 });
      const res = await validate(c.code);
      assert.equal(res.body.data.totals.discount, 0);
      assert.ok(res.body.data.coupon.rejected);
    });

    it('reports an unknown coupon without blocking checkout', async () => {
      await basket();
      const res = await validate('NOSUCHCODE');
      assert.equal(res.body.data.totals.discount, 0);
      assert.ok(res.body.data.coupon.rejected);
      assert.equal(
        res.body.data.canCheckout,
        true,
        'a bad coupon must not stop the order going ahead',
      );
    });

    it('is case-insensitive', async () => {
      await basket();
      const c = await coupon({ discount_type: 'fixed', discount_value: 60 });
      const res = await validate(c.code.toLowerCase());
      assert.equal(res.body.data.totals.discount, 60);
    });
  });

  it('creates nothing', async () => {
    const before_ = await db.selectFrom('orders').select('id').execute();
    const user = await db
      .selectFrom('users')
      .select('id')
      .where('email', '=', ALICE)
      .executeTakeFirstOrThrow();
    const product = await db
      .selectFrom('products')
      .select('id')
      .where('is_active', '=', true)
      .limit(1)
      .executeTakeFirstOrThrow();
    const cart = await db
      .insertInto('carts')
      .values({ id: randomUUID(), user_id: user.id })
      .returning('id')
      .executeTakeFirstOrThrow();
    await db
      .insertInto('cart_items')
      .values({
        id: randomUUID(),
        cart_id: cart.id,
        product_id: product.id,
        quantity: 1,
      })
      .execute();

    await call({
      session: 'alice',
      method: 'POST',
      path: '/api/checkout/validate',
      body: {},
    });

    const after_ = await db.selectFrom('orders').select('id').execute();
    assert.equal(
      after_.length,
      before_.length,
      'validation must not create an order; E9 does that',
    );
  });
});
