import { Kysely } from 'kysely';
import { db, type Database } from '../client.js';

export const REQUIRED_CATEGORIES = [
  'car-flags',
  'bike-flags',
  'accessories',
  'gift-sets',
] as const;

export type RequiredCategorySlug = (typeof REQUIRED_CATEGORIES)[number];

export interface SeedProductDef {
  id: string;
  name: string;
  description: string;
  categorySlug: RequiredCategorySlug;
  price: number;
  image: string;
  is_active: boolean;
  stock: number;
}

export const SEED_PRODUCTS: readonly SeedProductDef[] = [
  {
    id: '018d0000-0000-4000-8000-000000000001',
    name: 'ZYVORA Premium Car Flag — Tricolour',
    description:
      'Premium polyester car flag with reinforced stitching. Weather-resistant, UV-protected colours. Includes telescopic pole and secure mounting clip. Size: 30x20 cm. Perfect for national holidays, road trips, and daily pride.',
    categorySlug: 'car-flags',
    price: 499,
    image:
      'https://images.unsplash.com/photo-1549399542-7e3f8b79c341?w=600&h=400&fit=crop',
    is_active: true,
    stock: 100,
  },
  {
    id: '018d0000-0000-4000-8000-000000000002',
    name: 'ZYVORA Deluxe Car Flag — Saffron & Green',
    description:
      'Double-sided premium car flag with embroidered Ashoka Chakra. High-strength polyester, fade-resistant. Telescopic aluminium pole (up to 1.2m) with anti-slip base. Size: 30x20 cm.',
    categorySlug: 'car-flags',
    price: 699,
    image:
      'https://images.unsplash.com/photo-1583121274602-3e2820c69888?w=600&h=400&fit=crop',
    is_active: true,
    stock: 75,
  },
  {
    id: '018d0000-0000-4000-8000-000000000003',
    name: 'ZYVORA Bike Flag — Racing Stripes',
    description:
      'Aerodynamic bike flag with carbon-fibre look pole. Quick-release magnetic mount. Reflective accents for night visibility. Weatherproof nylon. Size: 15x10 cm.',
    categorySlug: 'bike-flags',
    price: 299,
    image:
      'https://images.unsplash.com/photo-1567808291548-fc3ee04dbcf0?w=600&h=400&fit=crop',
    is_active: true,
    stock: 150,
  },
  {
    id: '018d0000-0000-4000-8000-000000000004',
    name: 'ZYVORA Bike Flag — Tricolour Mini',
    description:
      'Compact tricolour bike flag for motorcycles and scooters. Flexible fibreglass pole, vibration-resistant mount. UV-coated polyester. Size: 12x8 cm.',
    categorySlug: 'bike-flags',
    price: 199,
    image:
      'https://images.unsplash.com/photo-1571068316344-75bc76f77890?w=600&h=400&fit=crop',
    is_active: true,
    stock: 200,
  },
  {
    id: '018d0000-0000-4000-8000-000000000005',
    name: 'ZYVORA Magnetic Mount Kit — Universal',
    description:
      'Strong neodymium magnetic base with protective rubber coating. Fits all ZYVORA poles. Quick on/off, no scratches. Includes 2 mounts for dual-flag setup.',
    categorySlug: 'accessories',
    price: 399,
    image:
      'https://images.unsplash.com/photo-1503376780353-7e6692767b70?w=600&h=400&fit=crop',
    is_active: true,
    stock: 120,
  },
  {
    id: '018d0000-0000-4000-8000-000000000006',
    name: 'ZYVORA Telescopic Pole — Carbon Fibre (1.5m)',
    description:
      'Ultra-light carbon fibre telescopic pole extends to 1.5m. Twist-lock mechanism, corrosion-resistant. Compatible with all ZYVORA flags.',
    categorySlug: 'accessories',
    price: 899,
    image:
      'https://images.unsplash.com/photo-1617788138017-80ad40651399?w=600&h=400&fit=crop',
    is_active: true,
    stock: 50,
  },
  {
    id: '018d0000-0000-4000-8000-000000000007',
    name: 'ZYVORA Enthusiast Gift Set — Car + Bike',
    description:
      'Complete kit: 1× Premium Car Flag (Tricolour), 1× Bike Flag (Tricolour Mini), 1× Magnetic Mount, 1× Carbon Fibre Pole (1.5m). Premium gift box with certificate of authenticity.',
    categorySlug: 'gift-sets',
    price: 1999,
    image:
      'https://images.unsplash.com/photo-1549465220-1a8b9238cd48?w=600&h=400&fit=crop',
    is_active: true,
    stock: 25,
  },
  {
    id: '018d0000-0000-4000-8000-000000000008',
    name: 'ZYVORA Family Pack — 3 Car Flags',
    description:
      'Three premium car flags: Tricolour, Saffron & Green, and Navy Blue. Includes 3 telescopic poles and mounts. Perfect for family road trips or gifting.',
    categorySlug: 'gift-sets',
    price: 1499,
    image:
      'https://images.unsplash.com/photo-1494976388531-d1058494cdd8?w=600&h=400&fit=crop',
    is_active: true,
    stock: 40,
  },
];

export function inventoryIdForProduct(productId: string): string {
  return productId.replace(/^018d0000/, '018d0001');
}

export interface SeedResult {
  productsInserted: number;
  productsSkipped: number;
  inventoryInserted: number;
  inventorySkipped: number;
}

export async function seed(
  database: Kysely<Database> = db,
  productsToSeed: readonly SeedProductDef[] = SEED_PRODUCTS,
): Promise<SeedResult> {
  console.log('Seeding database...');

  return await database.transaction().execute(async (trx) => {
    // 1. Validate required categories upfront
    const categories = await trx
      .selectFrom('categories')
      .select(['id', 'slug'])
      .where('slug', 'in', REQUIRED_CATEGORIES)
      .execute();

    const catMap = new Map(categories.map((c) => [c.slug, c.id]));
    const missing = REQUIRED_CATEGORIES.filter((slug) => !catMap.has(slug));
    if (missing.length > 0) {
      throw new Error(
        `Cannot seed catalogue: missing required categories: ${missing.join(', ')}. ` +
          'Ensure reference data migrations (e.g. 20261018120050_insert_reference_data.sql) have been applied.',
      );
    }

    let productsInserted = 0;
    let productsSkipped = 0;
    let inventoryInserted = 0;
    let inventorySkipped = 0;

    // 2. Insert or skip each product based on stable id
    for (const product of productsToSeed) {
      const existingProduct = await trx
        .selectFrom('products')
        .select('id')
        .where('id', '=', product.id)
        .executeTakeFirst();

      if (existingProduct) {
        productsSkipped++;
      } else {
        const categoryId = catMap.get(product.categorySlug);
        if (!categoryId) {
          throw new Error(`Category id missing for ${product.categorySlug}`);
        }
        await trx
          .insertInto('products')
          .values({
            id: product.id,
            name: product.name,
            description: product.description,
            category_id: categoryId,
            price: product.price,
            image: product.image,
            is_active: product.is_active,
            created_at: new Date(),
            updated_at: new Date(),
          })
          .execute();
        productsInserted++;
      }

      // 3. Ensure inventory row exists for this product (1:1 with products)
      const existingInv = await trx
        .selectFrom('inventory')
        .select('id')
        .where('product_id', '=', product.id)
        .executeTakeFirst();

      if (existingInv) {
        inventorySkipped++;
      } else {
        await trx
          .insertInto('inventory')
          .values({
            id: inventoryIdForProduct(product.id),
            product_id: product.id,
            quantity: product.stock,
            reserved_quantity: 0,
            created_at: new Date(),
            updated_at: new Date(),
          })
          .execute();
        inventoryInserted++;
      }
    }

    const result: SeedResult = {
      productsInserted,
      productsSkipped,
      inventoryInserted,
      inventorySkipped,
    };

    console.log(
      `Seeding complete: products (inserted: ${productsInserted}, skipped: ${productsSkipped}), ` +
        `inventory (inserted: ${inventoryInserted}, skipped: ${inventorySkipped})`,
    );

    return result;
  });
}

// CLI entry point
if (
  process.argv[1] &&
  (process.argv[1].endsWith('seed.ts') || process.argv[1].endsWith('seed.js'))
) {
  seed()
    .then(async () => {
      await db.destroy();
    })
    .catch(async (err) => {
      console.error('Seeding failed:', err);
      await db.destroy().catch(() => {});
      process.exit(1);
    });
}
