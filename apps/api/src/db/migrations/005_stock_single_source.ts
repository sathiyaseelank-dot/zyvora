import { Kysely, sql } from 'kysely';

/**
 * Migration 005 — one source of truth for stock.
 *
 * Drops `products.stock_quantity`.
 *
 * It was never read by anything: no route, no query, no serialiser. The seed
 * wrote a realistic per-product figure into it while writing a hardcoded 100
 * into `inventory`, and `inventory` is what the catalog and the cart read.
 * The result was that a product seeded with 25 units advertised 100 in stock —
 * a storefront willing to sell 75 flags nobody has.
 *
 * The column is removed rather than synced because a second, plausible-looking
 * stock column on the product row is exactly the trap: the next person writing
 * order creation (E9) or admin stock editing (E10) would reach for
 * `products.stock_quantity`, because it is right there and needs no join.
 *
 * `inventory` keeps the richer model this story actually needs — on-hand and
 * reserved, so a checkout in flight does not oversell.
 *
 * Data first: every product's intended stock is moved into inventory before the
 * column goes, so nothing is lost. Re-running this migration is safe; the
 * `IF EXISTS` guards make it a no-op on a database that has already applied it.
 */
export async function up(db: Kysely<any>): Promise<void> {
  // Carry the intended figure across where the two disagree. Products where
  // they already agree are untouched.
  await sql`
    UPDATE inventory
       SET quantity = p.stock_quantity,
           updated_at = now()
      FROM products p
     WHERE p.id = inventory.product_id
       AND p.stock_quantity IS DISTINCT FROM inventory.quantity
  `.execute(db);

  await sql`ALTER TABLE products DROP COLUMN IF EXISTS stock_quantity`.execute(
    db,
  );
}

export async function down(db: Kysely<any>): Promise<void> {
  // The column is re-added as a mirror of on-hand stock. It cannot recover the
  // original per-product intent, which is why this is a compatibility shim for
  // rollback rather than a true inverse: inventory is the source of truth, so
  // the column is derived from it.
  await sql`
    ALTER TABLE products
      ADD COLUMN IF NOT EXISTS stock_quantity integer NOT NULL DEFAULT 0
  `.execute(db);

  await sql`
    UPDATE products p
       SET stock_quantity = COALESCE(i.quantity, 0)
      FROM (SELECT product_id, quantity FROM inventory) i
     WHERE i.product_id = p.id
  `.execute(db);
}
