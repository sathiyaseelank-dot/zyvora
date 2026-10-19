import { Kysely, sql } from 'kysely';

/**
 * Migration 007 — admin content, banner management, and product price comparison.
 *
 * Supports:
 * - ZYV-78: `compare_at_price` column on products for strike-through price comparison
 * - ZYV-93: `banners` table for homepage promotional carousel/banners
 * - ZYV-93: `content_blocks` table for policy and informational pages (shipping, cancellation, etc.)
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    ALTER TABLE products
      ADD COLUMN IF NOT EXISTS compare_at_price integer;
  `.execute(db);

  await sql`
    CREATE TABLE IF NOT EXISTS banners (
      id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
      title character varying(255) NOT NULL,
      image_url character varying(1024) NOT NULL,
      link_url character varying(1024),
      display_order integer NOT NULL DEFAULT 0,
      is_active boolean NOT NULL DEFAULT true,
      created_at timestamp with time zone NOT NULL DEFAULT now(),
      updated_at timestamp with time zone NOT NULL DEFAULT now()
    );
  `.execute(db);

  await sql`
    CREATE TABLE IF NOT EXISTS content_blocks (
      id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
      slug character varying(100) NOT NULL UNIQUE,
      title character varying(255) NOT NULL,
      body text NOT NULL,
      updated_at timestamp with time zone NOT NULL DEFAULT now()
    );
  `.execute(db);

  // Seed default policy blocks so the pages are populated immediately
  await sql`
    INSERT INTO content_blocks (slug, title, body)
    VALUES
      ('shipping-policy', 'Shipping Policy', 'Standard delivery within 3-5 business days across India.'),
      ('cancellation-policy', 'Cancellation Policy', 'Orders may be cancelled within 2 hours of placement before dispatch.'),
      ('return-refund-policy', 'Return & Refund Policy', 'Items may be returned within 7 days of delivery in original condition.'),
      ('privacy-policy', 'Privacy Policy', 'We value customer privacy and do not sell personal data.'),
      ('terms-and-conditions', 'Terms & Conditions', 'Use of ZYVORA storefront is subject to standard terms of service.')
    ON CONFLICT (slug) DO NOTHING;
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP TABLE IF EXISTS content_blocks`.execute(db);
  await sql`DROP TABLE IF EXISTS banners`.execute(db);
  await sql`ALTER TABLE products DROP COLUMN IF EXISTS compare_at_price`.execute(
    db,
  );
}
