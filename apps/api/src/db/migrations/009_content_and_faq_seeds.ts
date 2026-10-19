import { Kysely, sql } from 'kysely';

/**
 * Migration 009 — FAQ, About Us, and Contact Us content blocks with honest business placeholders.
 *
 * Supports:
 * - ZYV-102: Frequently Asked Questions page content
 * - ZYV-103: Contact Us page content with uninvented business placeholders
 * - ZYV-104: About Us page brand story
 * - ZYV-117: Label placeholders for missing business details
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    INSERT INTO content_blocks (slug, title, body)
    VALUES
      (
        'faq',
        'Frequently Asked Questions',
        'Find answers to common questions about ZYVORA handcrafted automotive flags, vehicle compatibility, wind durability, ordering, and delivery.'
      ),
      (
        'about-us',
        'About ZYVORA',
        'Handcrafted in India, ZYVORA engineers premium car and bike flags built for the highway. Cut from UV-stabilised automotive polyester and triple-stitched along the fly edge, each flag is tested for road speeds up to 120 km/h.'
      ),
      (
        'contact-us',
        'Contact Us',
        'Have a question about your order or flag specifications? Reach our customer care team at support@zyvora.com (Monday – Saturday, 10:00 AM – 6:00 PM IST). Registered Office & Phone: [Pending Official Configuration].'
      )
    ON CONFLICT (slug) DO NOTHING;
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`
    DELETE FROM content_blocks WHERE slug IN ('faq', 'about-us', 'contact-us');
  `.execute(db);
}
