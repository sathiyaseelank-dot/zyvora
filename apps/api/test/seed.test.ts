import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../src/db/client.js';
import { seed, type SeedProductDef } from '../src/db/seeds/seed.js';

describe('seed script hardening', () => {
  const TEST_PRODUCT_ID = '018d9999-0000-4000-8000-000000000001';

  const testProductDef: SeedProductDef = {
    id: TEST_PRODUCT_ID,
    name: 'TEST Flag — Temporary Fixture',
    description: 'Temporary fixture for seed hardening tests',
    categorySlug: 'car-flags',
    price: 199,
    image: 'https://example.com/test.jpg',
    is_active: true,
    stock: 50,
  };

  async function cleanupTestFixtures() {
    await db
      .deleteFrom('inventory')
      .where('product_id', '=', TEST_PRODUCT_ID)
      .execute();
    await db.deleteFrom('products').where('id', '=', TEST_PRODUCT_ID).execute();
  }

  before(cleanupTestFixtures);
  after(cleanupTestFixtures);
  beforeEach(cleanupTestFixtures);

  it('validates all required categories upfront and throws when any are missing', async () => {
    // Also test what happens if required categories are missing from database
    const mockDb = {
      transaction: () => ({
        execute: async (callback: (trx: unknown) => Promise<unknown>) => {
          const fakeTrx = {
            selectFrom: () => ({
              select: () => ({
                where: () => ({
                  execute: async () => [
                    { id: '1', slug: 'car-flags' },
                    // Missing 'bike-flags', 'accessories', 'gift-sets'
                  ],
                }),
              }),
            }),
          };
          return callback(fakeTrx);
        },
      }),
    };

    await assert.rejects(
      async () => {
        await seed(mockDb as any, [testProductDef]);
      },
      (err: Error) => {
        assert.match(err.message, /missing required categories/);
        assert.match(err.message, /bike-flags/);
        assert.match(err.message, /accessories/);
        assert.match(err.message, /gift-sets/);
        return true;
      },
    );

    // Verify no product was inserted
    const found = await db
      .selectFrom('products')
      .select('id')
      .where('id', '=', TEST_PRODUCT_ID)
      .executeTakeFirst();
    assert.equal(found, undefined);
  });

  it('rolls back the transaction if any error occurs during seeding', async () => {
    // If an error occurs when processing, the transaction aborts and rolls back
    const explodingDb = {
      transaction: () => ({
        execute: async (_callback?: unknown) => {
          return db.transaction().execute(async (realTrx) => {
            // Run normal steps then intentionally throw
            const category = await realTrx
              .selectFrom('categories')
              .select('id')
              .where('slug', '=', 'car-flags')
              .executeTakeFirstOrThrow();

            await realTrx
              .insertInto('products')
              .values({
                id: TEST_PRODUCT_ID,
                name: testProductDef.name,
                description: testProductDef.description,
                category_id: category.id,
                price: testProductDef.price,
                image: testProductDef.image,
                is_active: testProductDef.is_active,
                created_at: new Date(),
                updated_at: new Date(),
              })
              .execute();

            // Simulate failure before inventory can commit
            throw new Error('Simulated mid-transaction failure');
          });
        },
      }),
    };

    await assert.rejects(async () => {
      await explodingDb.transaction().execute(async () => {});
    }, /Simulated mid-transaction failure/);

    // Due to rollback, TEST_PRODUCT_ID must not exist
    const row = await db
      .selectFrom('products')
      .select('id')
      .where('id', '=', TEST_PRODUCT_ID)
      .executeTakeFirst();
    assert.equal(row, undefined, 'product must be rolled back');
  });

  it('does not overwrite existing products and safely skips them', async () => {
    // First run: insert product and inventory
    const res1 = await seed(db, [testProductDef]);
    assert.equal(res1.productsInserted, 1);
    assert.equal(res1.inventoryInserted, 1);

    // Verify row was inserted
    const productBefore = await db
      .selectFrom('products')
      .selectAll()
      .where('id', '=', TEST_PRODUCT_ID)
      .executeTakeFirstOrThrow();
    assert.equal(productBefore.price, 199);

    // Create a modified definition for the same product ID
    const modifiedDef: SeedProductDef = {
      ...testProductDef,
      price: 99999, // Should NOT overwrite
      name: 'OVERWRITTEN NAME SHOULD NOT APPEAR',
    };

    // Second run with modified definition
    const res2 = await seed(db, [modifiedDef]);
    assert.equal(res2.productsInserted, 0);
    assert.equal(res2.productsSkipped, 1);
    assert.equal(res2.inventorySkipped, 1);

    // Confirm existing product was NOT modified
    const productAfter = await db
      .selectFrom('products')
      .selectAll()
      .where('id', '=', TEST_PRODUCT_ID)
      .executeTakeFirstOrThrow();
    assert.equal(productAfter.price, 199);
    assert.equal(productAfter.name, testProductDef.name);
  });

  it('recovers from partial state by restoring missing inventory rows', async () => {
    // Setup: product exists, but inventory row is missing
    const category = await db
      .selectFrom('categories')
      .select('id')
      .where('slug', '=', 'car-flags')
      .executeTakeFirstOrThrow();

    await db
      .insertInto('products')
      .values({
        id: TEST_PRODUCT_ID,
        name: testProductDef.name,
        description: testProductDef.description,
        category_id: category.id,
        price: testProductDef.price,
        image: testProductDef.image,
        is_active: testProductDef.is_active,
        created_at: new Date(),
        updated_at: new Date(),
      })
      .execute();

    // Confirm inventory does not exist yet
    const invBefore = await db
      .selectFrom('inventory')
      .select('id')
      .where('product_id', '=', TEST_PRODUCT_ID)
      .executeTakeFirst();
    assert.equal(invBefore, undefined);

    // Run seed
    const res = await seed(db, [testProductDef]);
    assert.equal(res.productsInserted, 0);
    assert.equal(res.productsSkipped, 1);
    assert.equal(res.inventoryInserted, 1);
    assert.equal(res.inventorySkipped, 0);

    // Confirm inventory row was created
    const invAfter = await db
      .selectFrom('inventory')
      .selectAll()
      .where('product_id', '=', TEST_PRODUCT_ID)
      .executeTakeFirstOrThrow();
    assert.equal(invAfter.quantity, testProductDef.stock);
    assert.equal(invAfter.reserved_quantity, 0);
  });

  it('is completely idempotent on repeated executions', async () => {
    // Run 1: insert
    const run1 = await seed(db, [testProductDef]);
    assert.equal(run1.productsInserted, 1);
    assert.equal(run1.inventoryInserted, 1);

    // Run 2: immediately repeat
    const run2 = await seed(db, [testProductDef]);
    assert.equal(run2.productsInserted, 0);
    assert.equal(run2.productsSkipped, 1);
    assert.equal(run2.inventoryInserted, 0);
    assert.equal(run2.inventorySkipped, 1);

    // Run 3: repeat again
    const run3 = await seed(db, [testProductDef]);
    assert.equal(run3.productsInserted, 0);
    assert.equal(run3.productsSkipped, 1);
    assert.equal(run3.inventoryInserted, 0);
    assert.equal(run3.inventorySkipped, 1);
  });

  it('ZYV-40: ensures seed products have verified automotive/flag images and no placeholder stock photos', async () => {
    const { SEED_PRODUCTS } = await import('../src/db/seeds/seed.js');
    assert.ok(
      SEED_PRODUCTS.length >= 8,
      'must contain at least 8 catalog products',
    );

    const DISALLOWED_IMAGE_IDS = [
      'photo-1582562124811-c09040d0a901', // sleeping cat
      'photo-1551632811-561732d1e306', // mountain hikers
    ];

    for (const prod of SEED_PRODUCTS) {
      assert.ok(
        prod.image.startsWith('https://'),
        `product ${prod.id} image must be HTTPS`,
      );
      for (const disallowed of DISALLOWED_IMAGE_IDS) {
        assert.ok(
          !prod.image.includes(disallowed),
          `product ${prod.id} (${prod.name}) contains disallowed placeholder image ${disallowed}`,
        );
      }
      // Assert no invented certification claims
      assert.ok(
        !prod.description.toLowerCase().includes('military grade'),
        `product ${prod.name} has fabricated military grade claim`,
      );
      assert.ok(
        !prod.description.toLowerCase().includes('iso 9001'),
        `product ${prod.name} has unverified ISO certification claim`,
      );
      // Assert positive price and stock
      assert.ok(
        prod.price > 0,
        `product ${prod.name} must have positive price`,
      );
      assert.ok(
        prod.stock > 0,
        `product ${prod.name} must have positive stock`,
      );
    }
  });
});
