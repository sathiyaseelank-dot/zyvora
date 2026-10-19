import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createApp } from '../src/app.js';
import { db } from '../src/db/client.js';
import { startServer, getJson, type TestClient } from './helpers.js';

/**
 * Catalogue behaviour (ZYV-105).
 *
 *   ZYV-30  categories      ZYV-37  filter, sort, pagination
 *   ZYV-41  search           ZYV-33  product detail
 *
 * The catalogue had NO behavioural coverage before this file. `app-wiring` held
 * a single reachability assertion — `status === 200` — which passes just as
 * happily when the sort is inverted, the category filter is ignored, the page
 * window never advances, or every product is advertised as in stock. A 200 says
 * a route is mounted; it says nothing about whether it is right.
 *
 * Fixtures are prefixed `ZQ`, which sorts before `ZYVORA` and so lands at the
 * head of every ascending page. Assertions can therefore read the head of a
 * real page instead of trying to isolate fixtures from seeded data.
 *
 * The suite runs single-threaded (`--test-concurrency=1`) because it shares one
 * database with the cart and auth suites. Without that, fixtures inserted here
 * are picked up by `cart.test.ts`, which selects products by `order by id` —
 * and UUID ordering is random.
 */

const REVIEWER_EMAIL = 'zyv-105-reviewer@example.invalid';
const PREFIX = 'ZQ ';

interface Rating {
  average: number;
  count: number;
}

interface Summary {
  id: string;
  name: string;
  price: number;
  category: string;
  image: string;
  inStock: boolean;
  rating: Rating | null;
}

interface ListBody {
  data: Summary[];
  meta: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    sort: string;
    category?: string;
  };
}

let client: TestClient;
let reviewerId: string;
const createdProductIds: string[] = [];

/** The five fixtures whose relative ordering is the thing under test. */
const ORDERED = [
  { name: `${PREFIX}Aardvark`, price: 100 },
  { name: `${PREFIX}Beacon`, price: 500 },
  { name: `${PREFIX}Cedar`, price: 300 },
  { name: `${PREFIX}Delta`, price: 200 },
  { name: `${PREFIX}Ember`, price: 400 },
] as const;

const ORDERED_NAMES = ORDERED.map((f) => f.name);

async function idFor(
  table: 'categories' | 'roles',
  column: string,
  value: string,
) {
  const query =
    table === 'categories'
      ? db.selectFrom('categories').select('id').where('slug', '=', value)
      : db.selectFrom('roles').select('id').where('name', '=', value);
  const row = await query.executeTakeFirstOrThrow();
  void column;
  return row.id;
}

async function makeProduct(
  categorySlug: string,
  name: string,
  price: number,
  opts: { active?: boolean; quantity?: number | null; reserved?: number } = {},
): Promise<string> {
  const row = await db
    .insertInto('products')
    .values({
      name,
      description: `Fixture product ${name}`,
      category_id: await idFor('categories', 'slug', categorySlug),
      price,
      image: 'https://example.invalid/fixture.jpg',
      is_active: opts.active ?? true,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  createdProductIds.push(row.id);

  // `quantity: null` deliberately creates NO inventory row — the case that must
  // report out-of-stock rather than throwing or defaulting to available.
  if (opts.quantity !== null) {
    await db
      .insertInto('inventory')
      .values({
        product_id: row.id,
        quantity: opts.quantity ?? 10,
        reserved_quantity: opts.reserved ?? 0,
      })
      .execute();
  }
  return row.id;
}

async function list(query: string): Promise<ListBody> {
  const res = await getJson<ListBody>(client, `/api/products${query}`);
  assert.equal(res.status, 200, `GET /api/products${query} must succeed`);
  return res.body;
}

/** Fixture product names only, in the order the API returned them. */
function fixtureNames(body: ListBody): string[] {
  return body.data.map((p) => p.name).filter((n) => n.startsWith(PREFIX));
}

async function findFixture(name: string): Promise<Summary> {
  const body = await list('?category=gift-sets&pageSize=100');
  const found = body.data.find((p) => p.name === name);
  assert.ok(found, `fixture ${name} missing from the listing`);
  return found;
}

async function review(
  productId: string,
  rating: number,
  verified: boolean,
): Promise<void> {
  await db
    .insertInto('reviews')
    .values({
      product_id: productId,
      user_id: reviewerId,
      rating,
      is_verified_purchase: verified,
    })
    .execute();
}

before(async () => {
  client = await startServer(createApp());

  const user = await db
    .insertInto('users')
    .values({
      email: REVIEWER_EMAIL,
      // Never verified against: nothing signs in as this account. A review only
      // needs a real owner to satisfy the foreign key.
      password_hash: 'fixture-not-a-real-hash',
      full_name: 'ZYV-105 Reviewer',
      role_id: await idFor('roles', 'name', 'customer'),
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  reviewerId = user.id;

  for (const f of ORDERED) {
    await makeProduct('gift-sets', f.name, f.price, { quantity: 10 });
  }

  // On hand but fully reserved. The boundary a naive `quantity > 0` check gets
  // wrong: stock exists, none of it is sellable.
  await makeProduct('gift-sets', `${PREFIX}Reserved`, 600, {
    quantity: 5,
    reserved: 5,
  });
  // No inventory row at all.
  await makeProduct('gift-sets', `${PREFIX}Ghost`, 700, { quantity: null });
  // Inactive: must never surface in any public listing.
  await makeProduct('gift-sets', `${PREFIX}Hidden`, 800, {
    active: false,
    quantity: 10,
  });
  // Outside the filtered category, to prove the filter actually filters.
  await makeProduct('car-flags', `${PREFIX}OtherCategory`, 900, {
    quantity: 10,
  });
});

after(async () => {
  // Reviews, inventory and carts all cascade from the product.
  await db
    .deleteFrom('products')
    .where('id', 'in', createdProductIds)
    .execute();
  await db.deleteFrom('users').where('email', '=', REVIEWER_EMAIL).execute();
  await client.close();
  await db.destroy();
});

describe('catalogue: filtering', () => {
  it('returns only the requested category', async () => {
    const body = await list('?category=gift-sets&pageSize=100');
    assert.ok(body.data.length > 0);
    for (const p of body.data) {
      assert.equal(p.category, 'gift-sets');
    }
    assert.ok(
      !fixtureNames(body).includes(`${PREFIX}OtherCategory`),
      'a car-flags product leaked through the gift-sets filter',
    );
  });

  it('excludes inactive products', async () => {
    const body = await list('?category=gift-sets&pageSize=100');
    assert.ok(
      !fixtureNames(body).includes(`${PREFIX}Hidden`),
      'an inactive product was listed',
    );
  });

  it('rejects an unknown category instead of silently ignoring it', async () => {
    // An ignored filter returns the whole catalogue and looks like success.
    assert.equal(
      (await getJson(client, '/api/products?category=nope')).status,
      400,
    );
  });
});

describe('catalogue: sorting', () => {
  it('orders by name ascending', async () => {
    const body = await list('?category=gift-sets&sort=name_asc&pageSize=100');
    const names = fixtureNames(body);
    assert.deepEqual(names.slice(0, ORDERED_NAMES.length), ORDERED_NAMES);
  });

  it('orders by name descending', async () => {
    const asc = await list('?category=gift-sets&sort=name_asc&pageSize=100');
    const desc = await list('?category=gift-sets&sort=name_desc&pageSize=100');

    // Same set of fixtures, opposite order. Asserted against the ascending
    // result rather than a hardcoded list, so this fails if either sort
    // breaks, instead of only when both happen to break together.
    const ascending = fixtureNames(asc);
    const descending = fixtureNames(desc);
    assert.ok(
      descending.length > 1,
      'descending order is untestable with fewer than two fixtures',
    );
    assert.deepEqual(descending, [...ascending].reverse());
  });

  it('orders by price ascending', async () => {
    const body = await list('?category=gift-sets&sort=price_asc&pageSize=100');
    const prices = body.data
      .filter((p) => ORDERED_NAMES.includes(p.name as never))
      .map((p) => p.price);
    assert.deepEqual(prices, [100, 200, 300, 400, 500]);
  });

  it('orders by price descending', async () => {
    const body = await list('?category=gift-sets&sort=price_desc&pageSize=100');
    const prices = body.data
      .filter((p) => ORDERED_NAMES.includes(p.name as never))
      .map((p) => p.price);
    assert.deepEqual(prices, [500, 400, 300, 200, 100]);
  });

  it('defaults to name_asc when no sort is given', async () => {
    const implicit = await list('?category=gift-sets&pageSize=100');
    const explicit = await list(
      '?category=gift-sets&sort=name_asc&pageSize=100',
    );
    assert.equal(implicit.meta.sort, 'name_asc');
    assert.deepEqual(fixtureNames(implicit), fixtureNames(explicit));
  });

  it('rejects an unknown sort rather than falling back silently', async () => {
    assert.equal(
      (await getJson(client, '/api/products?sort=sideways')).status,
      400,
    );
  });
});

describe('catalogue: pagination', () => {
  it('advances the window without repeating a product', async () => {
    const first = await list(
      '?category=gift-sets&sort=name_asc&pageSize=3&page=1',
    );
    const second = await list(
      '?category=gift-sets&sort=name_asc&pageSize=3&page=2',
    );

    assert.equal(first.data.length, 3);
    assert.equal(second.data.length, 3);
    assert.equal(first.meta.page, 1);
    assert.equal(second.meta.page, 2);

    const firstIds = new Set(first.data.map((p) => p.id));
    for (const p of second.data) {
      assert.ok(!firstIds.has(p.id), `${p.name} appeared on two pages`);
    }
  });

  it('reports a total consistent with a single full page', async () => {
    const page = await list('?category=gift-sets&pageSize=100');
    assert.equal(page.meta.total, page.data.length);
    assert.equal(page.meta.totalPages, 1);
  });

  it('computes totalPages as ceil(total / pageSize)', async () => {
    const all = await list('?category=gift-sets&pageSize=100');
    const paged = await list('?category=gift-sets&pageSize=4');
    assert.equal(paged.meta.totalPages, Math.ceil(all.meta.total / 4));
  });

  it('returns an empty page past the end rather than erroring', async () => {
    const beyond = await list('?category=gift-sets&pageSize=100&page=99');
    assert.deepEqual(beyond.data, []);
  });

  it('rejects an oversized pageSize and a page below one', async () => {
    assert.equal(
      (await getJson(client, '/api/products?pageSize=101')).status,
      400,
    );
    assert.equal((await getJson(client, '/api/products?page=0')).status, 400);
  });

  it('reports one page, not zero, when a category has nothing active', async () => {
    // Reaching `total === 0` means every active product in the category has to
    // be switched off first: the four slugs are a closed enum and all four are
    // seeded, so no filter can select an empty set. Seeded rows are restored in
    // `finally`, so a failed assertion cannot leave the shared database altered
    // for whichever suite runs next.
    const seeded = await db
      .selectFrom('products')
      .innerJoin('categories', 'categories.id', 'products.category_id')
      .select(['products.id', 'products.is_active'])
      .where('categories.slug', '=', 'gift-sets')
      .execute();
    const fixtures = await db
      .selectFrom('products')
      .select(['id', 'is_active'])
      .where('id', 'in', createdProductIds)
      .execute();

    // Captured, not assumed. Restoring "everything to active" would silently
    // resurrect the `Hidden` fixture, which is inactive on purpose — which is
    // exactly what happened the first time this test was written.
    const original = new Map(
      [...seeded, ...fixtures].map((p) => [p.id, p.is_active]),
    );
    const ids = [...original.keys()];

    try {
      await db
        .updateTable('products')
        .set({ is_active: false })
        .where('id', 'in', ids)
        .execute();

      const empty = await list('?category=gift-sets&pageSize=100');
      assert.equal(empty.meta.total, 0);
      assert.deepEqual(empty.data, []);
      assert.equal(
        empty.meta.totalPages,
        1,
        'an empty result must still report one page, or the UI renders "page 1 of 0"',
      );
    } finally {
      for (const [id, isActive] of original) {
        await db
          .updateTable('products')
          .set({ is_active: isActive })
          .where('id', '=', id)
          .execute();
      }
    }
  });
});

describe('catalogue: stock', () => {
  it('reports in stock when on-hand exceeds reserved', async () => {
    assert.equal((await findFixture(`${PREFIX}Aardvark`)).inStock, true);
  });

  it('reports out of stock when everything on hand is reserved', async () => {
    const product = await findFixture(`${PREFIX}Reserved`);
    assert.equal(
      product.inStock,
      false,
      'stock that exists but is fully reserved must not read as available',
    );
  });

  it('reports out of stock when there is no inventory row', async () => {
    const product = await findFixture(`${PREFIX}Ghost`);
    assert.equal(
      product.inStock,
      false,
      'a missing inventory row must not default to available',
    );
  });
});

describe('catalogue: ratings', () => {
  it('reports no rating at all when there are no reviews', async () => {
    const body = await list('?category=gift-sets&pageSize=100');
    for (const p of body.data) {
      assert.equal(
        p.rating,
        null,
        `${p.name} reported a rating with no reviews behind it`,
      );
    }
  });

  it('averages verified purchases and ignores unverified ones', async () => {
    const ember = await findFixture(`${PREFIX}Ember`);
    await review(ember.id, 5, true);
    await review(ember.id, 4, true);
    await review(ember.id, 1, false);

    const body = await list('?category=gift-sets&pageSize=100');
    const updated = body.data.find((p) => p.id === ember.id);
    assert.deepEqual(
      updated?.rating,
      { average: 4.5, count: 2 },
      'an unverified review must not move the average',
    );
  });

  it('rounds the average to one decimal place', async () => {
    const delta = await findFixture(`${PREFIX}Delta`);
    await review(delta.id, 5, true);
    await review(delta.id, 4, true);
    await review(delta.id, 4, true);

    const body = await list('?category=gift-sets&pageSize=100');
    const updated = body.data.find((p) => p.id === delta.id);
    assert.deepEqual(updated?.rating, { average: 4.3, count: 3 });
  });

  it('keeps ratings per product rather than blending them', async () => {
    const body = await list('?category=gift-sets&pageSize=100');
    const delta = body.data.find((p) => p.name === `${PREFIX}Delta`);
    const cedar = body.data.find((p) => p.name === `${PREFIX}Cedar`);
    assert.deepEqual(delta?.rating, { average: 4.3, count: 3 });
    assert.equal(cedar?.rating, null, 'one product rating leaked onto another');
  });
});

describe('catalogue: detail', () => {
  it('returns the product with its description and stock', async () => {
    const target = await findFixture(`${PREFIX}Aardvark`);
    const res = await getJson<{ data: Summary & { description: string } }>(
      client,
      `/api/products/${target.id}`,
    );
    assert.equal(res.status, 200);
    assert.equal(res.body.data.name, target.name);
    assert.equal(res.body.data.description, `Fixture product ${target.name}`);
    assert.equal(res.body.data.inStock, true);
    assert.equal(res.body.data.quantityAvailable, 10);
  });

  it('agrees with the listing on availability', async () => {
    for (const name of [`${PREFIX}Reserved`, `${PREFIX}Ghost`]) {
      const listed = await findFixture(name);
      const res = await getJson<{ data: Summary }>(
        client,
        `/api/products/${listed.id}`,
      );
      assert.equal(res.body.data.inStock, listed.inStock);
    }
  });

  it('404s an unknown id', async () => {
    const res = await getJson(
      client,
      '/api/products/00000000-0000-4000-8000-000000000000',
    );
    assert.equal(res.status, 404);
  });

  it('404s an inactive product rather than exposing it', async () => {
    const hidden = await db
      .selectFrom('products')
      .select('id')
      .where('name', '=', `${PREFIX}Hidden`)
      .executeTakeFirstOrThrow();
    assert.equal(
      (await getJson(client, `/api/products/${hidden.id}`)).status,
      404,
    );
  });

  it('400s a non-UUID id', async () => {
    assert.equal(
      (await getJson(client, '/api/products/not-a-uuid')).status,
      400,
    );
  });

  it('carries the same rating the listing showed', async () => {
    const ember = await findFixture(`${PREFIX}Ember`);
    assert.ok(ember.rating, 'fixture should have a rating by now');
    const res = await getJson<{ data: Summary }>(
      client,
      `/api/products/${ember.id}`,
    );
    assert.deepEqual(res.body.data.rating, ember.rating);
  });
});

describe('catalogue: search', () => {
  it('matches on name', async () => {
    const res = await getJson<ListBody>(
      client,
      '/api/products/search?q=Aardvark',
    );
    assert.equal(res.status, 200);
    assert.ok(res.body.data.some((p) => p.name.includes('Aardvark')));
  });

  it('matches on description as well as name', async () => {
    const res = await getJson<ListBody>(
      client,
      '/api/products/search?q=Fixture',
    );
    assert.equal(res.status, 200);
    assert.ok(res.body.data.length > 0);
  });

  it('does not match inactive products', async () => {
    const res = await getJson<ListBody>(
      client,
      '/api/products/search?q=Hidden',
    );
    assert.equal(res.status, 200);
    assert.ok(!res.body.data.some((p) => p.name === `${PREFIX}Hidden`));
  });

  it('returns an empty result set rather than erroring on no match', async () => {
    const res = await getJson<ListBody>(
      client,
      '/api/products/search?q=zzzzz-nothing-matches',
    );
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.data, []);
  });

  it('rejects an empty query', async () => {
    assert.equal(
      (await getJson(client, '/api/products/search?q=')).status,
      400,
    );
  });
});

describe('catalogue: categories', () => {
  it('lists the four seeded categories', async () => {
    const res = await getJson<{ data: { slug: string }[] }>(
      client,
      '/api/categories',
    );
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.data.map((c) => c.slug).sort(), [
      'accessories',
      'bike-flags',
      'car-flags',
      'gift-sets',
    ]);
  });

  it('serves the catalogue without a session', async () => {
    assert.equal(
      (await getJson(client, '/api/products?pageSize=1')).status,
      200,
    );
  });
});
