import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  // Enable UUID extension
  await sql`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`.execute(db);

  // Roles table
  await db.schema
    .createTable('roles')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`uuid_generate_v4()`),
    )
    .addColumn('name', 'varchar(50)', (col) => col.notNull().unique())
    .addColumn('description', 'text')
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  // Users table
  await db.schema
    .createTable('users')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`uuid_generate_v4()`),
    )
    .addColumn('email', 'varchar(255)', (col) => col.notNull().unique())
    .addColumn('password_hash', 'varchar(255)', (col) => col.notNull())
    .addColumn('full_name', 'varchar(255)')
    .addColumn('mobile', 'varchar(20)')
    .addColumn('role_id', 'uuid', (col) => col.notNull().references('roles.id'))
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  // Categories table
  await db.schema
    .createTable('categories')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`uuid_generate_v4()`),
    )
    .addColumn('name', 'varchar(100)', (col) => col.notNull().unique())
    .addColumn('slug', 'varchar(100)', (col) => col.notNull().unique())
    .addColumn('description', 'text')
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  // Products table
  await db.schema
    .createTable('products')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`uuid_generate_v4()`),
    )
    .addColumn('name', 'varchar(255)', (col) => col.notNull())
    .addColumn('description', 'text', (col) => col.notNull())
    .addColumn('category_id', 'uuid', (col) =>
      col.notNull().references('categories.id'),
    )
    .addColumn('price', 'integer', (col) => col.notNull()) // INR rupees
    .addColumn('image', 'varchar(500)', (col) => col.notNull())
    .addColumn('stock_quantity', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('is_active', 'boolean', (col) => col.notNull().defaultTo(true))
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  // Product images table
  await db.schema
    .createTable('product_images')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`uuid_generate_v4()`),
    )
    .addColumn('product_id', 'uuid', (col) =>
      col.notNull().references('products.id').onDelete('cascade'),
    )
    .addColumn('url', 'varchar(500)', (col) => col.notNull())
    .addColumn('alt_text', 'varchar(255)')
    .addColumn('display_order', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  // Insert default roles
  await db
    .insertInto('roles')
    .values([
      { name: 'customer', description: 'Regular customer' },
      { name: 'admin', description: 'Administrator with full access' },
    ])
    .execute();

  // Insert default categories (ZYVORA catalog)
  await db
    .insertInto('categories')
    .values([
      {
        name: 'Car Flags',
        slug: 'car-flags',
        description: 'Premium car flags for your vehicle',
      },
      {
        name: 'Bike Flags',
        slug: 'bike-flags',
        description: 'Stylish bike flags for motorcycles',
      },
      {
        name: 'Accessories',
        slug: 'accessories',
        description: 'Mounting accessories and add-ons',
      },
      {
        name: 'Gift Sets',
        slug: 'gift-sets',
        description: 'Curated gift sets for enthusiasts',
      },
    ])
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('product_images').execute();
  await db.schema.dropTable('products').execute();
  await db.schema.dropTable('categories').execute();
  await db.schema.dropTable('users').execute();
  await db.schema.dropTable('roles').execute();
}
