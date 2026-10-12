import { Kysely, sql } from 'kysely';

/**
 * Completes the schema declared by the Kysely `Database` interface in
 * ../client.ts. Migration 001 only created the catalog tables (roles, users,
 * categories, products, product_images); this adds commerce, order/payment,
 * engagement and audit tables (ZYV-23, ZYV-24, ZYV-26).
 *
 * Money columns are integer rupees, matching ProductTable.price and the
 * "no fractional currency" contract in @zyvora/types.
 */
export async function up(db: Kysely<any>): Promise<void> {
  // Commerce ----------------------------------------------------------------

  await db.schema
    .createTable('inventory')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`uuid_generate_v4()`),
    )
    .addColumn('product_id', 'uuid', (col) =>
      col.notNull().references('products.id').onDelete('cascade'),
    )
    .addColumn('quantity', 'integer', (col) => col.notNull())
    .addColumn('reserved_quantity', 'integer', (col) =>
      col.notNull().defaultTo(0),
    )
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await db.schema
    .createTable('carts')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`uuid_generate_v4()`),
    )
    .addColumn('user_id', 'uuid', (col) =>
      col.references('users.id').onDelete('cascade'),
    )
    .addColumn('session_id', 'varchar(255)')
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await db.schema
    .createTable('cart_items')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`uuid_generate_v4()`),
    )
    .addColumn('cart_id', 'uuid', (col) =>
      col.notNull().references('carts.id').onDelete('cascade'),
    )
    .addColumn('product_id', 'uuid', (col) =>
      col.notNull().references('products.id'),
    )
    .addColumn('quantity', 'integer', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await db.schema
    .createTable('addresses')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`uuid_generate_v4()`),
    )
    .addColumn('user_id', 'uuid', (col) =>
      col.references('users.id').onDelete('cascade'),
    )
    .addColumn('full_name', 'varchar(255)', (col) => col.notNull())
    .addColumn('mobile', 'varchar(20)', (col) => col.notNull())
    .addColumn('email', 'varchar(255)', (col) => col.notNull())
    .addColumn('house_number_and_street', 'text', (col) => col.notNull())
    .addColumn('area', 'varchar(255)', (col) => col.notNull())
    .addColumn('landmark', 'text')
    .addColumn('city', 'varchar(100)', (col) => col.notNull())
    .addColumn('state', 'varchar(100)', (col) => col.notNull())
    .addColumn('pin_code', 'varchar(10)', (col) => col.notNull())
    .addColumn('country', 'varchar(100)', (col) => col.notNull())
    .addColumn('delivery_instructions', 'text')
    .addColumn('is_default', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  // Orders & payments -------------------------------------------------------

  await db.schema
    .createTable('orders')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`uuid_generate_v4()`),
    )
    .addColumn('user_id', 'uuid', (col) => col.notNull().references('users.id'))
    .addColumn('checkout_session_id', 'uuid', (col) => col.notNull())
    .addColumn('subtotal', 'integer', (col) => col.notNull())
    .addColumn('shipping', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('tax', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('discount', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('total', 'integer', (col) => col.notNull())
    .addColumn('status', 'varchar(50)', (col) =>
      col.notNull().defaultTo('pending'),
    )
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await db.schema
    .createTable('order_items')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`uuid_generate_v4()`),
    )
    .addColumn('order_id', 'uuid', (col) =>
      col.notNull().references('orders.id').onDelete('cascade'),
    )
    .addColumn('product_id', 'uuid', (col) =>
      col.notNull().references('products.id'),
    )
    // Snapshot: the order line must keep the name and price as purchased,
    // not as currently catalogued (ZYV-27).
    .addColumn('name', 'varchar(255)', (col) => col.notNull())
    .addColumn('unit_price', 'integer', (col) => col.notNull())
    .addColumn('quantity', 'integer', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await db.schema
    .createTable('payments')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`uuid_generate_v4()`),
    )
    .addColumn('order_id', 'uuid', (col) =>
      col.notNull().references('orders.id').onDelete('cascade'),
    )
    .addColumn('razorpay_order_id', 'varchar(100)')
    .addColumn('razorpay_payment_id', 'varchar(100)')
    .addColumn('amount', 'integer', (col) => col.notNull())
    .addColumn('currency', 'varchar(3)', (col) =>
      col.notNull().defaultTo('INR'),
    )
    .addColumn('status', 'varchar(50)', (col) => col.notNull())
    .addColumn('method', 'varchar(50)')
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await db.schema
    .createTable('refunds')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`uuid_generate_v4()`),
    )
    .addColumn('payment_id', 'uuid', (col) =>
      col.notNull().references('payments.id').onDelete('cascade'),
    )
    .addColumn('amount', 'integer', (col) => col.notNull())
    .addColumn('reason', 'text', (col) => col.notNull())
    .addColumn('status', 'varchar(50)', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await db.schema
    .createTable('shipments')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`uuid_generate_v4()`),
    )
    .addColumn('order_id', 'uuid', (col) =>
      col.notNull().references('orders.id').onDelete('cascade'),
    )
    .addColumn('carrier', 'varchar(100)')
    .addColumn('tracking_number', 'varchar(100)')
    .addColumn('status', 'varchar(50)', (col) => col.notNull())
    .addColumn('shipped_at', 'timestamptz')
    .addColumn('delivered_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  // Engagement & audit ------------------------------------------------------

  await db.schema
    .createTable('reviews')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`uuid_generate_v4()`),
    )
    .addColumn('product_id', 'uuid', (col) =>
      col.notNull().references('products.id').onDelete('cascade'),
    )
    .addColumn('user_id', 'uuid', (col) =>
      col.notNull().references('users.id').onDelete('cascade'),
    )
    .addColumn('rating', 'integer', (col) => col.notNull())
    .addColumn('title', 'varchar(255)')
    .addColumn('body', 'text')
    .addColumn('is_verified_purchase', 'boolean', (col) =>
      col.notNull().defaultTo(false),
    )
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await db.schema
    .createTable('coupons')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`uuid_generate_v4()`),
    )
    .addColumn('code', 'varchar(50)', (col) => col.notNull().unique())
    .addColumn('discount_type', 'varchar(20)', (col) => col.notNull())
    .addColumn('discount_value', 'integer', (col) => col.notNull())
    .addColumn('min_order_amount', 'integer')
    .addColumn('max_discount', 'integer')
    .addColumn('usage_limit', 'integer')
    .addColumn('used_count', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('starts_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('expires_at', 'timestamptz')
    .addColumn('is_active', 'boolean', (col) => col.notNull().defaultTo(true))
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await db.schema
    .createTable('audit_logs')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`uuid_generate_v4()`),
    )
    .addColumn('user_id', 'uuid', (col) =>
      col.references('users.id').onDelete('set null'),
    )
    .addColumn('action', 'varchar(100)', (col) => col.notNull())
    .addColumn('entity_type', 'varchar(100)', (col) => col.notNull())
    .addColumn('entity_id', 'uuid')
    .addColumn('old_values', 'jsonb')
    .addColumn('new_values', 'jsonb')
    .addColumn('ip_address', 'varchar(45)')
    .addColumn('user_agent', 'text')
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  // Reverse creation order so foreign keys never dangle.
  for (const table of [
    'audit_logs',
    'coupons',
    'reviews',
    'shipments',
    'refunds',
    'payments',
    'order_items',
    'orders',
    'addresses',
    'cart_items',
    'carts',
    'inventory',
  ]) {
    await db.schema.dropTable(table).execute();
  }
}
