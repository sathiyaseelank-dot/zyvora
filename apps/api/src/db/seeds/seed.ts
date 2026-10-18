import { db } from '../client.js';
import * as crypto from 'crypto';

async function seed() {
  console.log('Seeding database...');

  // Idempotence guard. products has no natural unique key besides the primary
  // key, and every row is inserted with a fresh random UUID, so an
  // ON CONFLICT DO NOTHING clause can never actually match — re-running this
  // script would silently duplicate the whole catalogue. Refuse to run twice
  // instead of pretending the conflict clause protects us.
  const existing = await db.selectFrom('products').select('id').execute();
  if (existing.length > 0) {
    console.log(
      `Products already present (${existing.length}); nothing to seed.`,
    );
    console.log('Seeding complete!');
    await db.destroy();
    return;
  }

  // Get category IDs
  const categories = await db
    .selectFrom('categories')
    .select(['id', 'slug'])
    .execute();
  const catMap = new Map(
    categories.map((c: { id: string; slug: string }) => [c.slug, c.id]),
  );

  // Seed products
  const products = [
    {
      name: 'ZYVORA Premium Car Flag — Tricolour',
      description:
        'Premium polyester car flag with reinforced stitching. Weather-resistant, UV-protected colours. Includes telescopic pole and secure mounting clip. Size: 30x20 cm. Perfect for national holidays, road trips, and daily pride.',
      category_id: catMap.get('car-flags')!,
      price: 499,
      image:
        'https://images.unsplash.com/photo-1582562124811-c09040d0a901?w=600&h=400&fit=crop',
      is_active: true,
      // Stock lives in `inventory` only. See migration 005.
      stock: 100,
    },
    {
      name: 'ZYVORA Deluxe Car Flag — Saffron & Green',
      description:
        'Double-sided premium car flag with embroidered Ashoka Chakra. High-strength polyester, fade-resistant. Telescopic aluminium pole (up to 1.2m) with anti-slip base. Size: 30x20 cm.',
      category_id: catMap.get('car-flags')!,
      price: 699,
      image:
        'https://images.unsplash.com/photo-1583121274602-3e2820c69888?w=600&h=400&fit=crop',
      is_active: true,
      // Stock lives in `inventory` only. See migration 005.
      stock: 75,
    },
    {
      name: 'ZYVORA Bike Flag — Racing Stripes',
      description:
        'Aerodynamic bike flag with carbon-fibre look pole. Quick-release magnetic mount. Reflective accents for night visibility. Weatherproof nylon. Size: 15x10 cm.',
      category_id: catMap.get('bike-flags')!,
      price: 299,
      image:
        'https://images.unsplash.com/photo-1567808291548-fc3ee04dbcf0?w=600&h=400&fit=crop',
      is_active: true,
      // Stock lives in `inventory` only. See migration 005.
      stock: 150,
    },
    {
      name: 'ZYVORA Bike Flag — Tricolour Mini',
      description:
        'Compact tricolour bike flag for motorcycles and scooters. Flexible fibreglass pole, vibration-resistant mount. UV-coated polyester. Size: 12x8 cm.',
      category_id: catMap.get('bike-flags')!,
      price: 199,
      image:
        'https://images.unsplash.com/photo-1571068316344-75bc76f77890?w=600&h=400&fit=crop',
      is_active: true,
      // Stock lives in `inventory` only. See migration 005.
      stock: 200,
    },
    {
      name: 'ZYVORA Magnetic Mount Kit — Universal',
      description:
        'Strong neodymium magnetic base with protective rubber coating. Fits all ZYVORA poles. Quick on/off, no scratches. Includes 2 mounts for dual-flag setup.',
      category_id: catMap.get('accessories')!,
      price: 399,
      image:
        'https://images.unsplash.com/photo-1503376780353-7e6692767b70?w=600&h=400&fit=crop',
      is_active: true,
      // Stock lives in `inventory` only. See migration 005.
      stock: 120,
    },
    {
      name: 'ZYVORA Telescopic Pole — Carbon Fibre (1.5m)',
      description:
        'Ultra-light carbon fibre telescopic pole extends to 1.5m. Twist-lock mechanism, corrosion-resistant. Compatible with all ZYVORA flags.',
      category_id: catMap.get('accessories')!,
      price: 899,
      image:
        'https://images.unsplash.com/photo-1551632811-561732d1e306?w=600&h=400&fit=crop',
      is_active: true,
      // Stock lives in `inventory` only. See migration 005.
      stock: 50,
    },
    {
      name: 'ZYVORA Enthusiast Gift Set — Car + Bike',
      description:
        'Complete kit: 1× Premium Car Flag (Tricolour), 1× Bike Flag (Tricolour Mini), 1× Magnetic Mount, 1× Carbon Fibre Pole (1.5m). Premium gift box with certificate of authenticity.',
      category_id: catMap.get('gift-sets')!,
      price: 1999,
      image:
        'https://images.unsplash.com/photo-1549465220-1a8b9238cd48?w=600&h=400&fit=crop',
      is_active: true,
      // Stock lives in `inventory` only. See migration 005.
      stock: 25,
    },
    {
      name: 'ZYVORA Family Pack — 3 Car Flags',
      description:
        'Three premium car flags: Tricolour, Saffron & Green, and Navy Blue. Includes 3 telescopic poles and mounts. Perfect for family road trips or gifting.',
      category_id: catMap.get('gift-sets')!,
      price: 1499,
      image:
        'https://images.unsplash.com/photo-1494976388531-d1058494cdd8?w=600&h=400&fit=crop',
      is_active: true,
      // Stock lives in `inventory` only. See migration 005.
      stock: 40,
    },
  ];

  // Product name -> inserted id, so inventory can be attached without a second
  // round trip or a query keyed on a name that is not unique by schema.
  const insertedIds = new Map<string, string>();

  for (const product of products) {
    const inserted = await db
      .insertInto('products')
      .values({
        // `stock` is deliberately not spread into products: the column does
        // not exist (migration 005). It is consumed when inventory is seeded.
        name: product.name,
        description: product.description,
        category_id: product.category_id,
        price: product.price,
        image: product.image,
        is_active: product.is_active,
        id: crypto.randomUUID(),
        created_at: new Date(),
        updated_at: new Date(),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    insertedIds.set(product.name, inserted.id);
  }

  // Seed inventory (1:1 with products), from the figures declared alongside the
  // products above rather than a round trip — the `products` table has no stock
  // column at all (migration 005).
  for (const product of products) {
    await db
      .insertInto('inventory')
      .values({
        id: crypto.randomUUID(),
        product_id: insertedIds.get(product.name)!,
        // The product's declared stock, not a flat 100.
        //
        // It used to be 100 for every row while the per-product figure went
        // into `products.stock_quantity` — a column nothing read. Since the
        // catalog and the cart both take stock from `inventory`, every product
        // advertised 100 units regardless of its actual stock, and a 25-unit
        // product would have been sold 75 times over.
        quantity: product.stock,
        reserved_quantity: 0,
        created_at: new Date(),
        updated_at: new Date(),
      })
      .execute();
  }

  console.log('Seeding complete!');
  await db.destroy();
}

seed().catch((err) => {
  console.error('Seeding failed:', err);
  process.exit(1);
});
