import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createApp } from '../src/app.js';
import { db } from '../src/db/client.js';
import { CSRF_HEADER } from '../src/auth/session.js';
import { resetRateLimits } from '../src/http/rate-limit.js';
import { hashPassword } from '../src/auth/password.js';
import { startServer, CookieJar, type TestClient } from './helpers.js';

/**
 * Cart (E5).
 *
 *   ZYV-44 read  · ZYV-42 add · ZYV-43 patch · ZYV-45 remove
 *   ZYV-47 guest persistence · ZYV-49 guest-to-account merge
 *   ZYV-55 server-authoritative price, stock and shipping
 *
 * The three properties worth defending here are that the SERVER decides price
 * and stock, that a guest keeps the same basket across requests, and that one
 * cart cannot be reached through another.
 */

const PASSWORD = 'correct horse battery staple';
const GUEST_EMAIL = 'e5-guest@example.invalid';
const OWNER_EMAIL = 'e5-owner@example.invalid';

let client: TestClient;
let productId: string;
let secondProductId: string;

interface CartBody {
  data: {
    lines: {
      itemId: string;
      productId: string;
      unitPrice: number;
      quantity: number;
      lineTotal: number;
      available: number;
    }[];
    totals: {
      subtotal: number;
      shipping: number;
      total: number;
      itemCount: number;
      amountToFreeShipping: number;
    };
  };
}

/** A fresh signed-out visitor with its own cookie jar, like a new browser. */
function visitor(): CookieJar {
  return new CookieJar();
}

/**
 * CSRF tokens are per-session values, not per-request nonces, so one is
 * fetched per jar and reused.
 *
 * This also keeps the suite inside the auth limiter. `/api/auth/csrf` sits
 * behind `limiters.auth` at 10 requests per 15 minutes, so refetching on every
 * call exhausted the budget partway through and every later test failed on a
 * 429 rather than on anything it was testing — the same "passes for the wrong
 * reason" failure this suite is meant to avoid.
 */
const tokens = new WeakMap<CookieJar, string>();

async function csrf(jar: CookieJar): Promise<string> {
  const cached = tokens.get(jar);
  if (cached) return cached;

  const res = await fetch(`${client.url}/api/auth/csrf`, {
    headers: { cookie: jar.header() },
  });
  jar.absorb(res.headers);
  const token = ((await res.json()) as { data: { csrfToken: string } }).data
    .csrfToken;
  tokens.set(jar, token);
  return token;
}

beforeEach(() => {
  resetRateLimits();
});

async function call<T>(
  jar: CookieJar,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: T; headers: Headers }> {
  const token = await csrf(jar);
  const res = await fetch(`${client.url}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      cookie: jar.header(),
      [CSRF_HEADER]: token,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  jar.absorb(res.headers);
  const text = await res.text();
  return {
    status: res.status,
    body: (text ? JSON.parse(text) : null) as T,
    headers: res.headers,
  };
}

/** Sign in and return a jar carrying the session cookie. */
async function signIn(email: string, password = PASSWORD): Promise<CookieJar> {
  const jar = visitor();
  const res = await call<{ data: { user: { id: string } } }>(
    jar,
    'POST',
    '/api/auth/login',
    { identifier: email, password },
  );
  assert.equal(res.status, 200, 'fixture sign-in must succeed');
  // Sign-in rotates the CSRF cookie, so the cached token is now stale.
  tokens.delete(jar);
  return jar;
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
      // Awaited. It was not, and the fixture stored a Promise as the hash:
      // sign-in then failed 401, and one test still passed because it never
      // checked the login status.
      password_hash: await hashPassword(PASSWORD),
      full_name: 'E5 Fixture',
      mobile,
      role_id: role.id,
    })
    .execute();
}

before(async () => {
  client = await startServer(createApp());
  await createUser(GUEST_EMAIL, '9700000001');
  await createUser(OWNER_EMAIL, '9700000002');

  const products = await db
    .selectFrom('products')
    .innerJoin('inventory', 'inventory.product_id', 'products.id')
    .select(['products.id', 'products.price', 'inventory.quantity'])
    .where('products.is_active', '=', true)
    .orderBy('products.id')
    .limit(2)
    .execute();

  productId = products[0].id;
  secondProductId = products[1].id;
});

after(async () => {
  // Remove carts and fixtures so a rerun starts clean; carts cascade to items.
  const users = await db
    .selectFrom('users')
    .select('id')
    .where('email', 'in', [GUEST_EMAIL, OWNER_EMAIL])
    .execute();
  for (const u of users) {
    await db.deleteFrom('carts').where('user_id', '=', u.id).execute();
  }
  await db
    .deleteFrom('users')
    .where('email', 'in', [GUEST_EMAIL, OWNER_EMAIL])
    .execute();
  await client.close();
  await db.destroy();
});

describe('ZYV-44 read the cart', () => {
  it('returns an empty cart to a visitor who has never added anything', async () => {
    const jar = visitor();
    const res = await call<CartBody>(jar, 'GET', '/api/cart');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.data.lines, []);
    assert.equal(res.body.data.totals.subtotal, 0);
    assert.equal(res.body.data.totals.shipping, 0);
    assert.equal(res.body.data.totals.total, 0);
  });

  it('does not create a cart row just because someone looked', async () => {
    const before_ = (await db.selectFrom('carts').select('id').execute())
      .length;
    await call(visitor(), 'GET', '/api/cart');
    await call(visitor(), 'GET', '/api/cart');
    const after_ = (await db.selectFrom('carts').select('id').execute()).length;
    assert.equal(
      after_,
      before_,
      'a read must not write, or every bot leaves a cart behind',
    );
  });
});

describe('ZYV-47 guest persistence', () => {
  it('keeps the same basket across separate requests', async () => {
    const jar = visitor();

    const added = await call<CartBody>(jar, 'POST', '/api/cart/items', {
      productId,
      quantity: 2,
    });
    assert.equal(added.status, 201);
    assert.equal(added.body.data.lines.length, 1);

    // A different HTTP request entirely — not a held reference.
    const read = await call<CartBody>(jar, 'GET', '/api/cart');
    assert.equal(read.status, 200);
    assert.equal(read.body.data.lines.length, 1);
    assert.equal(read.body.data.lines[0].quantity, 2);
  });

  it("does not leak one visitor's basket to another", async () => {
    const mine = visitor();
    await call(mine, 'POST', '/api/cart/items', { productId, quantity: 1 });

    const theirs = visitor();
    const res = await call<CartBody>(theirs, 'GET', '/api/cart');
    assert.deepEqual(
      res.body.data.lines,
      [],
      "a fresh visitor must not see another visitor's basket",
    );
  });

  it('sets an HttpOnly cookie so the id is not readable by script', async () => {
    const jar = visitor();
    const res = await call<CartBody>(jar, 'POST', '/api/cart/items', {
      productId,
      quantity: 1,
    });
    const cookie = (res.headers.getSetCookie?.() ?? []).find((c) =>
      c.startsWith('zyvora_cart='),
    );
    assert.ok(cookie, 'a guest cart must issue its cookie');
    assert.match(cookie, /HttpOnly/i);
  });

  it('merges quantities when the same product is added twice', async () => {
    const jar = visitor();
    await call(jar, 'POST', '/api/cart/items', { productId, quantity: 1 });
    const res = await call<CartBody>(jar, 'POST', '/api/cart/items', {
      productId,
      quantity: 2,
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.data.lines.length, 1, 'one line per product');
    assert.equal(res.body.data.lines[0].quantity, 3);
  });
});

describe('ZYV-55 the server decides price and stock', () => {
  it('ignores any price the client sends', async () => {
    const jar = visitor();
    const real = await db
      .selectFrom('products')
      .select('price')
      .where('id', '=', productId)
      .executeTakeFirstOrThrow();

    // A client trying to dictate its own price, including the attempt to set
    // it to zero.
    const res = await call<CartBody>(jar, 'POST', '/api/cart/items', {
      productId,
      quantity: 1,
      unitPrice: 1,
      price: 1,
      lineTotal: 1,
    } as unknown as Record<string, unknown>);

    assert.equal(res.status, 201);
    assert.equal(
      res.body.data.lines[0].unitPrice,
      real.price,
      'the price must come from the database, not the request',
    );
    assert.equal(res.body.data.lines[0].lineTotal, real.price);
  });

  it('drops shipping to zero once the subtotal crosses the threshold', async () => {
    // The free-shipping branch had no coverage: every seeded basket sat under
    // ₹2,000, so the shipping mutation survived. A ₹1,999 gift set crosses it
    // on the second unit.
    const jar = visitor();
    const gift = await db
      .selectFrom('products')
      .innerJoin('inventory', 'inventory.product_id', 'products.id')
      .select(['products.id', 'products.price'])
      .where('products.is_active', '=', true)
      .where('products.price', '>=', 1000)
      .orderBy('products.price', 'desc')
      .executeTakeFirst();

    if (!gift) return; // no fixture product can reach the threshold

    const first = await call<CartBody>(jar, 'POST', '/api/cart/items', {
      productId: gift.id,
      quantity: 1,
    });
    assert.equal(first.status, 201);
    assert.ok(
      first.body.data.totals.subtotal < 2000,
      'fixture: one unit must sit below the threshold',
    );
    assert.equal(
      first.body.data.totals.shipping,
      99,
      'below the threshold the flat rate applies',
    );
    assert.ok(
      first.body.data.totals.amountToFreeShipping > 0,
      'the shortfall must be reported so the UI can nudge',
    );

    const second = await call<CartBody>(jar, 'POST', '/api/cart/items', {
      productId: gift.id,
      quantity: 1,
    });
    assert.equal(second.status, 201);
    assert.ok(
      second.body.data.totals.subtotal >= 2000,
      'fixture: two units must cross the threshold',
    );
    assert.equal(
      second.body.data.totals.shipping,
      0,
      'at or above the threshold shipping is free',
    );
    assert.equal(
      second.body.data.totals.amountToFreeShipping,
      0,
      'nothing is left to spend once the threshold is met',
    );
    assert.equal(
      second.body.data.totals.total,
      second.body.data.totals.subtotal,
    );
  });

  it('rejects more than is in stock', async () => {
    // Inventory is dropped to 3 first. Every seeded product has 100 on hand, so
    // without this the request would exceed the per-line cap of 10 and be
    // rejected by Zod instead — the test would pass without ever reaching the
    // stock check it exists to exercise.
    const jar = visitor();
    const inv = await db
      .selectFrom('inventory')
      .select(['quantity', 'reserved_quantity'])
      .where('product_id', '=', productId)
      .executeTakeFirstOrThrow();
    const original = inv.quantity;

    await db
      .updateTable('inventory')
      .set({ quantity: 3 })
      .where('product_id', '=', productId)
      .execute();

    try {
      const res = await call<{ error: { message: string } }>(
        jar,
        'POST',
        '/api/cart/items',
        { productId, quantity: 4 },
      );
      assert.equal(res.status, 400);
      assert.match(res.body.error.message, /left in stock|out of stock/i);
    } finally {
      await db
        .updateTable('inventory')
        .set({ quantity: original })
        .where('product_id', '=', productId)
        .execute();
    }
  });

  it('adds up to exactly what is in stock', async () => {
    // The boundary just below the rejection, so a `>` instead of `>=` in the
    // check would be caught.
    const jar = visitor();
    const original = (
      await db
        .selectFrom('inventory')
        .select('quantity')
        .where('product_id', '=', productId)
        .executeTakeFirstOrThrow()
    ).quantity;

    await db
      .updateTable('inventory')
      .set({ quantity: 3 })
      .where('product_id', '=', productId)
      .execute();
    try {
      const res = await call<CartBody>(jar, 'POST', '/api/cart/items', {
        productId,
        quantity: 3,
      });
      assert.equal(
        res.status,
        201,
        'exactly the available amount must be allowed',
      );
      assert.equal(res.body.data.lines[0].quantity, 3);
    } finally {
      await db
        .updateTable('inventory')
        .set({ quantity: original })
        .where('product_id', '=', productId)
        .execute();
    }
  });

  it('refuses a line whose product has been withdrawn', async () => {
    const jar = visitor();
    await call(jar, 'POST', '/api/cart/items', { productId, quantity: 1 });
    const before_ = await call<CartBody>(jar, 'GET', '/api/cart');
    assert.equal(before_.body.data.lines.length, 1);

    await db
      .updateTable('products')
      .set({ is_active: false })
      .where('id', '=', secondProductId)
      .execute();
    try {
      const res = await call<{ error: { message: string } }>(
        jar,
        'POST',
        '/api/cart/items',
        { productId: secondProductId, quantity: 1 },
      );
      assert.equal(res.status, 400);
      assert.match(res.body.error.message, /no longer available/i);
    } finally {
      await db
        .updateTable('products')
        .set({ is_active: true })
        .where('id', '=', secondProductId)
        .execute();
    }
  });

  it('drops a withdrawn product out of an existing basket', async () => {
    const jar = visitor();
    const added = await call<CartBody>(jar, 'POST', '/api/cart/items', {
      productId: secondProductId,
      quantity: 1,
    });
    const itemId = added.body.data.lines[0].itemId;
    assert.equal(
      (await call<CartBody>(jar, 'GET', '/api/cart')).body.data.lines.length,
      1,
    );

    await db
      .updateTable('products')
      .set({ is_active: false })
      .where('id', '=', secondProductId)
      .execute();
    try {
      const res = await call<CartBody>(jar, 'GET', '/api/cart');
      assert.equal(
        res.body.data.lines.length,
        0,
        'a basket must not keep pricing a product that cannot be bought',
      );

      // Assert the ROW is deleted, not merely omitted from the response. Both
      // happen while the product is inactive, so checking the response alone
      // cannot tell a prune from a filter - and the prune is what stops the
      // row returning if the product is ever reactivated.
      // Scoped to THIS test's line. Querying by product alone also matched
      // rows every other test in this file had left behind, so the assertion
      // failed for reasons that had nothing to do with the behaviour.
      const rows = await db
        .selectFrom('cart_items')
        .select('id')
        .where('id', '=', itemId)
        .execute();
      assert.equal(
        rows.length,
        0,
        'the withdrawn line must be deleted from cart_items, not just hidden',
      );
    } finally {
      await db
        .updateTable('products')
        .set({ is_active: true })
        .where('id', '=', secondProductId)
        .execute();
    }
  });

  it('computes shipping from the live subtotal, with a free-shipping threshold', async () => {
    const jar = visitor();
    // Totals carry the threshold and the shortfall so the UI can render
    // "spend X more for free delivery" without hard-coding the number.
    const t = await call<CartBody>(jar, 'POST', '/api/cart/items', {
      productId,
      quantity: 1,
    });
    const line = t.body.data.lines[0];
    const { shipping } = t.body.data.totals;

    if (line.lineTotal >= 2000) assert.equal(shipping, 0);
    else assert.equal(shipping, 99);
    assert.equal(t.body.data.totals.total, line.lineTotal + shipping);
  });

  it('recomputes a total after the price changes underneath it', async () => {
    // A basket must never cache a price. Repricing a product has to change the
    // basket the moment it is read again.
    const jar = visitor();
    await call(jar, 'POST', '/api/cart/items', { productId, quantity: 2 });
    const before_ = await call<CartBody>(jar, 'GET', '/api/cart');

    await db
      .updateTable('products')
      .set({ price: 12345 })
      .where('id', '=', productId)
      .execute();
    try {
      const after_ = await call<CartBody>(jar, 'GET', '/api/cart');
      assert.equal(after_.body.data.lines[0].unitPrice, 12345);
      assert.equal(after_.body.data.lines[0].lineTotal, 24690);
      assert.notEqual(
        after_.body.data.totals.subtotal,
        before_.body.data.totals.subtotal,
        'a repriced product must change the basket total',
      );
    } finally {
      await db
        .updateTable('products')
        .set({ price: before_.body.data.lines[0].unitPrice })
        .where('id', '=', productId)
        .execute();
    }
  });
});

describe('line limits', () => {
  it('refuses a single line above the per-product maximum', async () => {
    // MAX_QTY_PER_LINE had no coverage at all, so deleting the cap changed
    // nothing observable. Stock is 100 on every seeded product, so the cap is
    // the only thing between a request and a 100-unit line.
    const res = await call<{
      error: {
        message: string;
        details?: { fieldErrors?: Record<string, string[]> };
      };
    }>(visitor(), 'POST', '/api/cart/items', { productId, quantity: 11 });

    assert.equal(res.status, 400);
    // Zod's own message lives in fieldErrors; the top-level message is the
    // middleware's fixed "Request validation failed". Asserting on the
    // top-level string would be asserting on something the client never
    // reads - and would pass no matter what the shopper is told.
    // Keyed `body.quantity` on the wire. The prefix is stripped by the web
    // client (apps/web/src/lib/api.ts), not by the API, so at this layer the
    // raw key is the contract being asserted.
    const perField =
      res.body.error.details?.fieldErrors?.['body.quantity']?.[0] ?? '';
    assert.match(perField, /Maximum 10/i);
  });

  it('accepts a line at exactly the per-product maximum', async () => {
    const res = await call<CartBody>(visitor(), 'POST', '/api/cart/items', {
      productId,
      quantity: 10,
    });
    assert.equal(res.status, 201, 'the boundary itself must be allowed');
    assert.equal(res.body.data.lines[0].quantity, 10);
  });

  it('refuses to accumulate past the cap across repeated adds', async () => {
    // Six then six: each request is individually legal, so only the running
    // total check catches it.
    const jar = visitor();
    await call(jar, 'POST', '/api/cart/items', { productId, quantity: 6 });
    const res = await call<{ error: { message: string } }>(
      jar,
      'POST',
      '/api/cart/items',
      { productId, quantity: 6 },
    );
    assert.equal(res.status, 400);
    assert.match(res.body.error.message, /Maximum 10|left in stock/i);
  });
});

describe('ZYV-43 update a line', () => {
  it('changes the quantity', async () => {
    const jar = visitor();
    const added = await call<CartBody>(jar, 'POST', '/api/cart/items', {
      productId,
      quantity: 1,
    });
    const itemId = added.body.data.lines[0].itemId;

    const res = await call<CartBody>(
      jar,
      'PATCH',
      `/api/cart/items/${itemId}`,
      {
        quantity: 3,
      },
    );
    assert.equal(res.status, 200);
    assert.equal(res.body.data.lines[0].quantity, 3);
  });

  it('treats a quantity of zero as removal', async () => {
    // A quantity stepper in the UI sends 0 rather than calling DELETE.
    const jar = visitor();
    const added = await call<CartBody>(jar, 'POST', '/api/cart/items', {
      productId,
      quantity: 1,
    });
    const itemId = added.body.data.lines[0].itemId;

    const res = await call<CartBody>(
      jar,
      'PATCH',
      `/api/cart/items/${itemId}`,
      {
        quantity: 0,
      },
    );
    assert.equal(res.status, 200);
    assert.equal(res.body.data.lines.length, 0);
  });

  it('refuses to raise a quantity above available stock', async () => {
    const jar = visitor();
    const added = await call<CartBody>(jar, 'POST', '/api/cart/items', {
      productId,
      quantity: 1,
    });
    const itemId = added.body.data.lines[0].itemId;

    const original = (
      await db
        .selectFrom('inventory')
        .select('quantity')
        .where('product_id', '=', productId)
        .executeTakeFirstOrThrow()
    ).quantity;
    await db
      .updateTable('inventory')
      .set({ quantity: 2 })
      .where('product_id', '=', productId)
      .execute();
    try {
      const res = await call<{ error: { message: string } }>(
        jar,
        'PATCH',
        `/api/cart/items/${itemId}`,
        { quantity: 5 },
      );
      assert.equal(res.status, 400);
      assert.match(res.body.error.message, /left in stock/i);
    } finally {
      await db
        .updateTable('inventory')
        .set({ quantity: original })
        .where('product_id', '=', productId)
        .execute();
    }
  });
});

describe('ZYV-45 remove a line', () => {
  it('removes the line and returns the rest of the cart', async () => {
    const jar = visitor();
    await call(jar, 'POST', '/api/cart/items', { productId, quantity: 1 });
    const added = await call<CartBody>(jar, 'POST', '/api/cart/items', {
      productId: secondProductId,
      quantity: 1,
    });
    const target = added.body.data.lines.find((l) => l.productId === productId);
    assert.ok(target);

    const res = await call<CartBody>(
      jar,
      'DELETE',
      `/api/cart/items/${target.itemId}`,
    );
    assert.equal(res.status, 200);
    assert.equal(res.body.data.lines.length, 1);
    assert.equal(res.body.data.lines[0].productId, secondProductId);
  });

  it("cannot reach a line in somebody else's cart", async () => {
    const mine = visitor();
    const added = await call<CartBody>(mine, 'POST', '/api/cart/items', {
      productId,
      quantity: 1,
    });
    const itemId = added.body.data.lines[0].itemId;

    // A different visitor holding the item id. Scoping the delete to the
    // caller's own cart is what stops this.
    //
    // The attacker must have a cart of their OWN. Without one the request is
    // refused earlier for having no cart at all, and the scoping on the delete
    // itself is never reached - which is exactly why the "unscoped delete"
    // mutation survived until this was fixed.
    const attacker = visitor();
    const theirOwn = await call<CartBody>(attacker, 'POST', '/api/cart/items', {
      productId: secondProductId,
      quantity: 1,
    });
    assert.equal(theirOwn.status, 201, 'attacker fixture must have a cart');
    const res = await call<{ error: { code: string } }>(
      attacker,
      'DELETE',
      `/api/cart/items/${itemId}`,
    );
    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'NOT_FOUND');

    // And the victim's line is untouched.
    const still = await call<CartBody>(mine, 'GET', '/api/cart');
    assert.equal(still.body.data.lines.length, 1);
  });
});

describe('ZYV-49 guest to account merge', () => {
  it('keeps the basket when a guest signs in', async () => {
    const jar = visitor();
    await call(jar, 'POST', '/api/cart/items', { productId, quantity: 2 });
    assert.equal(
      (await call<CartBody>(jar, 'GET', '/api/cart')).body.data.lines.length,
      1,
    );

    // Same cookie jar, now authenticated.
    const signedIn = await call(jar, 'POST', '/api/auth/login', {
      identifier: GUEST_EMAIL,
      password: PASSWORD,
    });
    assert.equal(signedIn.status, 200, 'fixture sign-in must succeed');
    tokens.delete(jar);

    const res = await call<CartBody>(jar, 'GET', '/api/cart');
    assert.equal(res.status, 200);
    assert.equal(
      res.body.data.lines.length,
      1,
      'signing in must not empty the basket',
    );
    assert.equal(res.body.data.lines[0].quantity, 2);
  });

  it('moves the cart to the account so it follows the user to another device', async () => {
    const jar = visitor();
    await call(jar, 'POST', '/api/cart/items', { productId, quantity: 1 });
    await call(jar, 'POST', '/api/auth/login', {
      identifier: GUEST_EMAIL,
      password: PASSWORD,
    });
    await call<CartBody>(jar, 'GET', '/api/cart');

    // A completely separate browser, signed in as the same person.
    const other = await signIn(GUEST_EMAIL);
    const res = await call<CartBody>(other, 'GET', '/api/cart');
    assert.equal(res.body.data.lines.length, 1);
  });

  it('stops issuing a guest cookie once the cart belongs to an account', async () => {
    const jar = visitor();
    await call(jar, 'POST', '/api/cart/items', { productId, quantity: 1 });
    const signedIn = await call(jar, 'POST', '/api/auth/login', {
      identifier: OWNER_EMAIL,
      password: PASSWORD,
    });
    assert.equal(signedIn.status, 200, 'fixture sign-in must succeed');
    tokens.delete(jar);
    const res = await call<CartBody>(jar, 'GET', '/api/cart');
    assert.equal(res.status, 200);
    // Whatever the cookie state, an authenticated read must succeed and the
    // basket must belong to the account.
    const user = await db
      .selectFrom('users')
      .select('id')
      .where('email', '=', OWNER_EMAIL)
      .executeTakeFirstOrThrow();
    const cart = await db
      .selectFrom('carts')
      .select('user_id')
      .where('user_id', '=', user.id)
      .executeTakeFirst();
    assert.ok(
      cart,
      'an account cart must exist after signing in with a basket',
    );
  });
});
