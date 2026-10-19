import { Kysely, sql } from 'kysely';

/**
 * Migration 008 — order delivery address snapshot and customer order lifecycle fields.
 *
 * Supports:
 * - ZYV-61 & ZYV-64: `shipping_address_id` and immutable `shipping_address_snapshot` on orders
 * - ZYV-89: `cancel_reason` and `cancelled_at` on orders
 * - ZYV-87: `return_reason` and `return_requested_at` on orders
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    ALTER TABLE orders
      ADD COLUMN IF NOT EXISTS shipping_address_id uuid REFERENCES addresses(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS shipping_address_snapshot jsonb,
      ADD COLUMN IF NOT EXISTS cancel_reason text,
      ADD COLUMN IF NOT EXISTS cancelled_at timestamp with time zone,
      ADD COLUMN IF NOT EXISTS return_reason text,
      ADD COLUMN IF NOT EXISTS return_requested_at timestamp with time zone;
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`
    ALTER TABLE orders
      DROP COLUMN IF EXISTS return_requested_at,
      DROP COLUMN IF EXISTS return_reason,
      DROP COLUMN IF EXISTS cancelled_at,
      DROP COLUMN IF EXISTS cancel_reason,
      DROP COLUMN IF EXISTS shipping_address_snapshot,
      DROP COLUMN IF EXISTS shipping_address_id;
  `.execute(db);
}
