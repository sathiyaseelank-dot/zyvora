import { Router, type Request, type Response } from 'express';
import { z } from 'zod';

import { db } from '../db/client.js';
import type {
  ProductCategory,
  ProductSummary,
  RatingSummary,
} from '@zyvora/types';
import { asyncHandler } from '../http/async-handler.js';
import { AppError } from '../http/errors.js';
import { validate, valid } from '../http/validate.js';

/**
 * Public, unauthenticated catalog endpoints (ZYV-36).
 *
 * Story coverage:
 *   ZYV-30  GET /api/categories
 *   ZYV-37  GET /api/products  (filter, sort, pagination)
 *   ZYV-33  GET /api/products/:id
 *   ZYV-41  GET /api/products/search
 *
 * Validation now runs through the shared middleware (ZYV-34) instead of
 * per-handler `safeParse` calls, so every route rejects malformed input the
 * same way and returns the same error envelope.
 *
 * Money stays an integer rupee value end to end; only formatting to
 * "₹1,999" happens at the edge, never in the database.
 */

/** Closed union mirroring the category slugs seeded by migration 001. */
const categorySchema = z.enum([
  'car-flags',
  'bike-flags',
  'accessories',
  'gift-sets',
]);

const listQuerySchema = z.object({
  category: categorySchema.optional(),
  sort: z
    .enum(['price_asc', 'price_desc', 'name_asc', 'name_desc'])
    .default('name_asc'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(12),
});

const searchQuerySchema = z.object({
  q: z.string().trim().min(1, 'q must not be empty').max(200),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(12),
});

const idParamSchema = z.object({
  id: z.string().uuid('Product id must be a UUID'),
});

interface ListQuery {
  category?: z.infer<typeof categorySchema>;
  sort: 'price_asc' | 'price_desc' | 'name_asc' | 'name_desc';
  page: number;
  pageSize: number;
}

interface SearchQuery {
  q: string;
  page: number;
  pageSize: number;
}

/**
 * Stock is `inventory` and nothing else (migration 005). `inventory` holds
 * exactly one row per product — the seed writes one and nothing else does —
 * so a LEFT JOIN is safe here and cannot duplicate a product row and skew the
 * page window. If that invariant is ever broken, this join silently breaks
 * pagination rather than erroring, so it is stated rather than assumed.
 */
type SummaryRow = {
  id: string;
  name: string;
  price: number;
  image: string;
  category_slug: string;
  quantity: number | null;
  reserved_quantity: number | null;
};

/**
 * Verified-purchase ratings for a page of products.
 *
 * Two decisions that are both about not lying to the customer:
 *
 *  - Only `is_verified_purchase` rows count. An unverified review is a claim by
 *    someone who did not buy the flag, and averaging it in would put a number
 *    on the page that the business cannot stand behind.
 *  - A product with no verified reviews is absent from the map, so the summary
 *    carries `rating: null`. That is different from a rating of zero, and the
 *    UI must be able to tell the difference.
 *
 * Aggregated for the page's ids in one query rather than per product, so this
 * stays at two round trips per request regardless of page size.
 */
async function verifiedRatings(
  ids: string[],
): Promise<Map<string, RatingSummary>> {
  const ratings = new Map<string, RatingSummary>();
  if (ids.length === 0) return ratings;

  const rows = await db
    .selectFrom('reviews')
    .select([
      'product_id',
      (eb) => eb.fn.avg<number>('rating').as('average'),
      (eb) => eb.fn.countAll<string>().as('review_count'),
    ])
    .where('is_verified_purchase', '=', true)
    .where('product_id', 'in', ids)
    .groupBy('product_id')
    .execute();

  for (const row of rows) {
    const count = Number(row.review_count);
    const average = Number(row.average);
    // A count with no mean would mean every rating in the group was NULL. The
    // schema forbids that today, but a rating of `NaN` reaching the storefront
    // would render as "NaN★", so the row is dropped rather than forwarded.
    if (count === 0 || !Number.isFinite(average)) continue;
    ratings.set(row.product_id, {
      average: Math.round(average * 10) / 10,
      count,
    });
  }
  return ratings;
}

/**
 * Turns a page of rows into the wire shape. Stock and rating are passed in
 * rather than queried here so the three call sites stay symmetric.
 */
function toSummary(
  row: SummaryRow,
  stock: { inStock: boolean },
  ratings: Map<string, RatingSummary>,
): ProductSummary {
  return {
    id: row.id,
    name: row.name,
    price: row.price,
    category: row.category_slug as ProductCategory,
    image: row.image,
    inStock: stock.inStock,
    rating: ratings.get(row.id) ?? null,
  };
}

/** On-hand minus reserved. No `inventory` row means nothing is sellable. */
function sellable(row: SummaryRow): boolean {
  return (row.quantity ?? 0) - (row.reserved_quantity ?? 0) > 0;
}

export const catalogRouter: Router = Router();

/** ZYV-30 — GET /api/categories */
catalogRouter.get(
  '/categories',
  asyncHandler(async (_req: Request, res: Response) => {
    const categories = await db
      .selectFrom('categories')
      .select(['name', 'slug', 'description'])
      .orderBy('name', 'asc')
      .execute();

    res.json({ data: categories });
  }),
);

/** ZYV-37 — GET /api/products with filter, sort and pagination */
catalogRouter.get(
  '/products',
  validate({ query: listQuerySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { category, sort, page, pageSize } = valid<ListQuery>(req, 'query');

    let query = db
      .selectFrom('products')
      .innerJoin('categories', 'categories.id', 'products.category_id')
      .leftJoin('inventory', 'inventory.product_id', 'products.id')
      .select([
        'products.id',
        'products.name',
        'products.description',
        'products.price',
        'products.image',
        'categories.slug as category_slug',
        'inventory.quantity',
        'inventory.reserved_quantity',
      ])
      .where('products.is_active', '=', true);

    if (category) {
      query = query.where('categories.slug', '=', category);
    }

    switch (sort) {
      case 'price_asc':
        query = query.orderBy('products.price', 'asc');
        break;
      case 'price_desc':
        query = query.orderBy('products.price', 'desc');
        break;
      case 'name_desc':
        query = query.orderBy('products.name', 'desc');
        break;
      default:
        query = query.orderBy('products.name', 'asc');
    }

    const offset = (page - 1) * pageSize;
    const rows = await query.limit(pageSize).offset(offset).execute();

    // Count must ignore the page window but keep the same filters.
    // Deliberately NOT joined to inventory, unlike the page query above. An
    // inner join would exclude products that have no stock row, so `total` and
    // the rows on this page would disagree about how many products exist. The
    // row query LEFT JOINs and reports those products as out of stock instead.
    let countQuery = db
      .selectFrom('products')
      .innerJoin('categories', 'categories.id', 'products.category_id')
      .where('products.is_active', '=', true)
      .select((eb) => eb.fn.countAll<string>().as('total'));
    if (category) {
      countQuery = countQuery.where('categories.slug', '=', category);
    }
    const counted = await countQuery.executeTakeFirstOrThrow();
    const totalCount = Number(counted.total);

    const ratings = await verifiedRatings(rows.map((r) => r.id));

    res.json({
      data: rows.map((row) => toSummary(row, { inStock: sellable(row) }, ratings)),
      meta: {
        page,
        pageSize,
        total: totalCount,
        totalPages: Math.max(1, Math.ceil(totalCount / pageSize)),
        sort,
        ...(category ? { category } : {}),
      },
    });
  }),
);

/** ZYV-41 — GET /api/products/search?q= */
catalogRouter.get(
  '/products/search',
  validate({ query: searchQuerySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { q, page, pageSize } = valid<SearchQuery>(req, 'query');

    // Parameterised ILIKE — the value is bound, never interpolated.
    const pattern = `%${q}%`;
    const offset = (page - 1) * pageSize;

    const rows = await db
      .selectFrom('products')
      .innerJoin('categories', 'categories.id', 'products.category_id')
      .leftJoin('inventory', 'inventory.product_id', 'products.id')
      .select([
        'products.id',
        'products.name',
        'products.description',
        'products.price',
        'products.image',
        'categories.slug as category_slug',
        'inventory.quantity',
        'inventory.reserved_quantity',
      ])
      .where('products.is_active', '=', true)
      .where((eb) =>
        eb.or([
          eb('products.name', 'ilike', pattern),
          eb('products.description', 'ilike', pattern),
        ]),
      )
      .orderBy('products.name', 'asc')
      .limit(pageSize)
      .offset(offset)
      .execute();

    const ratings = await verifiedRatings(rows.map((r) => r.id));

    res.json({
      data: rows.map((row) => toSummary(row, { inStock: sellable(row) }, ratings)),
      meta: { page, pageSize, query: q },
    });
  }),
);

/** ZYV-33 — GET /api/products/:id */
catalogRouter.get(
  '/products/:id',
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = valid<{ id: string }>(req, 'params');

    const row = await db
      .selectFrom('products')
      .innerJoin('categories', 'categories.id', 'products.category_id')
      .leftJoin('inventory', 'inventory.product_id', 'products.id')
      .select([
        'products.id',
        'products.name',
        'products.description',
        'products.price',
        'products.image',
        'categories.slug as category_slug',
        'inventory.quantity',
        'inventory.reserved_quantity',
      ])
      .where('products.id', '=', id)
      .where('products.is_active', '=', true)
      .executeTakeFirst();

    if (!row) {
      throw new AppError('NOT_FOUND', 'Product not found');
    }

    const ratings = await verifiedRatings([row.id]);
    // Computed from the joined row rather than a second inventory query, so
    // the detail view and the listing can never disagree about availability.
    const onHand = (row.quantity ?? 0) - (row.reserved_quantity ?? 0);

    res.json({
      data: {
        ...toSummary(row, { inStock: onHand > 0 }, ratings),
        description: row.description,
        quantityAvailable: onHand,
      },
    });
  }),
);
