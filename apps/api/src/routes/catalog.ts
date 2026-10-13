import { Router, type Request, type Response } from 'express';
import { z } from 'zod';

import { db } from '../db/client.js';
import type { ProductCategory, ProductSummary } from '@zyvora/types';
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

function toSummary(row: {
  id: string;
  name: string;
  price: number;
  image: string;
  category_slug: string;
}): ProductSummary {
  return {
    id: row.id,
    name: row.name,
    price: row.price,
    category: row.category_slug as ProductCategory,
    image: row.image,
  };
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
      .select([
        'products.id',
        'products.name',
        'products.description',
        'products.price',
        'products.image',
        'categories.slug as category_slug',
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

    res.json({
      data: rows.map(toSummary),
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
      .select([
        'products.id',
        'products.name',
        'products.description',
        'products.price',
        'products.image',
        'categories.slug as category_slug',
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

    res.json({
      data: rows.map(toSummary),
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
      .select([
        'products.id',
        'products.name',
        'products.description',
        'products.price',
        'products.image',
        'categories.slug as category_slug',
      ])
      .where('products.id', '=', id)
      .where('products.is_active', '=', true)
      .executeTakeFirst();

    if (!row) {
      throw new AppError('NOT_FOUND', 'Product not found');
    }

    const available = await db
      .selectFrom('inventory')
      .select(['quantity', 'reserved_quantity'])
      .where('product_id', '=', id)
      .executeTakeFirst();

    const onHand = available
      ? available.quantity - available.reserved_quantity
      : 0;

    res.json({
      data: {
        ...toSummary(row),
        description: row.description,
        inStock: onHand > 0,
        quantityAvailable: onHand,
      },
    });
  }),
);
