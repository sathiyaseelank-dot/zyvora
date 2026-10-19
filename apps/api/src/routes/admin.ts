import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { sql } from 'kysely';

import { asyncHandler } from '../http/async-handler.js';
import { db } from '../db/client.js';
import { AppError } from '../http/errors.js';
import { validate, valid } from '../http/validate.js';
import { audit } from '../audit/audit-log.js';

export const adminRouter: Router = Router();

// ============================================================================
// 1. Audit Logs (ZYV-90)
// ============================================================================

const auditQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  action: z.string().trim().max(100).optional(),
  entityType: z.string().trim().max(100).optional(),
  entityId: z.string().trim().max(100).optional(),
});

type AuditQuery = z.infer<typeof auditQuerySchema>;

/** GET /api/admin/audit-log — read-only audit log viewer. */
adminRouter.get(
  '/audit-log',
  validate({ query: auditQuerySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { limit, action, entityType, entityId } = valid<AuditQuery>(
      req,
      'query',
    );

    let query = db
      .selectFrom('audit_logs')
      .selectAll()
      .orderBy('created_at', 'desc');

    if (action) query = query.where('action', '=', action);
    if (entityType) query = query.where('entity_type', '=', entityType);
    if (entityId) query = query.where('entity_id', '=', entityId);

    const rows = await query.limit(limit).execute();

    res.json({ data: rows, meta: { limit } });
  }),
);

const uuidParamSchema = z.object({ id: z.string().uuid() });

/** GET /api/admin/audit-log/:id — a single audit entry. */
adminRouter.get(
  '/audit-log/:id',
  validate({ params: uuidParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = valid<{ id: string }>(req, 'params');

    const row = await db
      .selectFrom('audit_logs')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();

    if (!row) throw new AppError('NOT_FOUND', 'Audit entry not found');
    res.json({ data: row });
  }),
);

// ============================================================================
// 2. Products Management (ZYV-92)
// ============================================================================

const productListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  category: z.string().trim().optional(),
  search: z.string().trim().optional(),
  status: z.enum(['all', 'active', 'archived']).default('all'),
});

/** GET /api/admin/products — search, filter, and paginate catalog items for admin. */
adminRouter.get(
  '/products',
  validate({ query: productListQuerySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { page, limit, category, search, status } = valid<
      z.infer<typeof productListQuerySchema>
    >(req, 'query');
    const offset = (page - 1) * limit;

    let baseQuery = db
      .selectFrom('products')
      .innerJoin('categories', 'categories.id', 'products.category_id')
      .leftJoin('inventory', 'inventory.product_id', 'products.id');

    if (category) {
      baseQuery = baseQuery.where('categories.slug', '=', category);
    }
    if (status === 'active') {
      baseQuery = baseQuery.where('products.is_active', '=', true);
    } else if (status === 'archived') {
      baseQuery = baseQuery.where('products.is_active', '=', false);
    }
    if (search) {
      const pattern = `%${search}%`;
      baseQuery = baseQuery.where((eb) =>
        eb.or([
          eb('products.name', 'ilike', pattern),
          eb('products.description', 'ilike', pattern),
        ]),
      );
    }

    const countResult = await baseQuery
      .select((eb) => eb.fn.count('products.id').as('count'))
      .executeTakeFirst();
    const total = Number(countResult?.count ?? 0);

    const rows = await baseQuery
      .select([
        'products.id',
        'products.name',
        'products.description',
        'products.category_id as categoryId',
        'categories.name as categoryName',
        'categories.slug as categorySlug',
        'products.price',
        'products.compare_at_price as compareAtPrice',
        'products.image',
        'products.is_active as isActive',
        'products.created_at as createdAt',
        'products.updated_at as updatedAt',
        'inventory.quantity as stock',
        'inventory.reserved_quantity as reservedStock',
      ])
      .orderBy('products.created_at', 'desc')
      .limit(limit)
      .offset(offset)
      .execute();

    res.json({
      data: rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  }),
);

/** GET /api/admin/products/:id — single product detail with inventory and images. */
adminRouter.get(
  '/products/:id',
  validate({ params: uuidParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = valid<{ id: string }>(req, 'params');

    const product = await db
      .selectFrom('products')
      .innerJoin('categories', 'categories.id', 'products.category_id')
      .leftJoin('inventory', 'inventory.product_id', 'products.id')
      .select([
        'products.id',
        'products.name',
        'products.description',
        'products.category_id as categoryId',
        'categories.name as categoryName',
        'categories.slug as categorySlug',
        'products.price',
        'products.compare_at_price as compareAtPrice',
        'products.image',
        'products.is_active as isActive',
        'products.created_at as createdAt',
        'products.updated_at as updatedAt',
        'inventory.quantity as stock',
        'inventory.reserved_quantity as reservedStock',
      ])
      .where('products.id', '=', id)
      .executeTakeFirst();

    if (!product) throw new AppError('NOT_FOUND', 'Product not found');

    const images = await db
      .selectFrom('product_images')
      .selectAll()
      .where('product_id', '=', id)
      .orderBy('display_order', 'asc')
      .execute();

    res.json({ data: { ...product, images } });
  }),
);

const createProductSchema = z.object({
  name: z.string().trim().min(2).max(255),
  description: z.string().trim().min(5),
  categoryId: z.string().uuid(),
  price: z.number().int().positive(),
  compareAtPrice: z.number().int().positive().nullable().optional(),
  image: z.string().url(),
  isActive: z.boolean().default(true),
  stock: z.number().int().min(0).default(0),
});

/** POST /api/admin/products — create a new product and initial inventory. */
adminRouter.post(
  '/products',
  validate({ body: createProductSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const input = valid<z.infer<typeof createProductSchema>>(req, 'body');

    // Verify category exists
    const category = await db
      .selectFrom('categories')
      .select('id')
      .where('id', '=', input.categoryId)
      .executeTakeFirst();

    if (!category) throw new AppError('NOT_FOUND', 'Category not found');

    const created = await db.transaction().execute(async (trx) => {
      const prod = await trx
        .insertInto('products')
        .values({
          name: input.name,
          description: input.description,
          category_id: input.categoryId,
          price: input.price,
          compare_at_price: input.compareAtPrice ?? null,
          image: input.image,
          is_active: input.isActive,
          created_at: new Date(),
          updated_at: new Date(),
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      await trx
        .insertInto('inventory')
        .values({
          product_id: prod.id,
          quantity: input.stock,
          reserved_quantity: 0,
          created_at: new Date(),
          updated_at: new Date(),
        })
        .execute();

      return prod;
    });

    await audit(req, {
      action: 'admin.create.product',
      entityType: 'product',
      entityId: created.id,
      newValues: { name: created.name, price: created.price, stock: input.stock },
    });

    res.status(201).json({ data: created });
  }),
);

const updateProductSchema = z.object({
  name: z.string().trim().min(2).max(255).optional(),
  description: z.string().trim().min(5).optional(),
  categoryId: z.string().uuid().optional(),
  price: z.number().int().positive().optional(),
  compareAtPrice: z.number().int().positive().nullable().optional(),
  image: z.string().url().optional(),
  isActive: z.boolean().optional(),
  stock: z.number().int().min(0).optional(),
});

/** PATCH /api/admin/products/:id — update product details. */
adminRouter.patch(
  '/products/:id',
  validate({ params: uuidParamSchema, body: updateProductSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = valid<{ id: string }>(req, 'params');
    const input = valid<z.infer<typeof updateProductSchema>>(req, 'body');

    const existing = await db
      .selectFrom('products')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();

    if (!existing) throw new AppError('NOT_FOUND', 'Product not found');

    if (input.categoryId) {
      const cat = await db
        .selectFrom('categories')
        .select('id')
        .where('id', '=', input.categoryId)
        .executeTakeFirst();
      if (!cat) throw new AppError('NOT_FOUND', 'Category not found');
    }

    const updated = await db.transaction().execute(async (trx) => {
      const valuesToUpdate: Record<string, unknown> = {
        updated_at: new Date(),
      };
      if (input.name !== undefined) valuesToUpdate.name = input.name;
      if (input.description !== undefined)
        valuesToUpdate.description = input.description;
      if (input.categoryId !== undefined)
        valuesToUpdate.category_id = input.categoryId;
      if (input.price !== undefined) valuesToUpdate.price = input.price;
      if (input.compareAtPrice !== undefined)
        valuesToUpdate.compare_at_price = input.compareAtPrice;
      if (input.image !== undefined) valuesToUpdate.image = input.image;
      if (input.isActive !== undefined) valuesToUpdate.is_active = input.isActive;

      const prod = await trx
        .updateTable('products')
        .set(valuesToUpdate)
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirstOrThrow();

      if (input.stock !== undefined) {
        await trx
          .updateTable('inventory')
          .set({ quantity: input.stock, updated_at: new Date() })
          .where('product_id', '=', id)
          .execute();
      }

      return prod;
    });

    await audit(req, {
      action: 'admin.patch.product',
      entityType: 'product',
      entityId: id,
      oldValues: {
        name: existing.name,
        price: existing.price,
        isActive: existing.is_active,
      },
      newValues: input,
    });

    res.json({ data: updated });
  }),
);

/** DELETE /api/admin/products/:id — archive product (hide from store). */
adminRouter.delete(
  '/products/:id',
  validate({ params: uuidParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = valid<{ id: string }>(req, 'params');

    const product = await db
      .selectFrom('products')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();

    if (!product) throw new AppError('NOT_FOUND', 'Product not found');

    await db
      .updateTable('products')
      .set({ is_active: false, updated_at: new Date() })
      .where('id', '=', id)
      .execute();

    await audit(req, {
      action: 'admin.archive.product',
      entityType: 'product',
      entityId: id,
      oldValues: { is_active: product.is_active },
      newValues: { is_active: false },
    });

    res.json({ data: { id, archived: true } });
  }),
);

// ============================================================================
// 3. Product Images (ZYV-80)
// ============================================================================

const allowedImageExtensions = /\.(jpg|jpeg|png|webp|svg|gif)(\?.*)?$/i;

const addImageSchema = z.object({
  url: z
    .string()
    .url()
    .refine((url) => allowedImageExtensions.test(url) || url.includes('unsplash.com') || url.includes('images.'), {
      message: 'Invalid file type: URL must point to an approved image file (.jpg, .jpeg, .png, .webp, .svg)',
    }),
  altText: z.string().trim().max(255).optional(),
  displayOrder: z.number().int().min(0).default(0),
  isPrimary: z.boolean().default(false),
});

/** GET /api/admin/products/:id/images — list gallery images for a product. */
adminRouter.get(
  '/products/:id/images',
  validate({ params: uuidParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = valid<{ id: string }>(req, 'params');

    const images = await db
      .selectFrom('product_images')
      .selectAll()
      .where('product_id', '=', id)
      .orderBy('display_order', 'asc')
      .execute();

    res.json({ data: images });
  }),
);

/** POST /api/admin/products/:id/images — upload and attach an image. */
adminRouter.post(
  '/products/:id/images',
  validate({ params: uuidParamSchema, body: addImageSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = valid<{ id: string }>(req, 'params');
    const input = valid<z.infer<typeof addImageSchema>>(req, 'body');

    const product = await db
      .selectFrom('products')
      .select('id')
      .where('id', '=', id)
      .executeTakeFirst();

    if (!product) throw new AppError('NOT_FOUND', 'Product not found');

    const image = await db.transaction().execute(async (trx) => {
      const img = await trx
        .insertInto('product_images')
        .values({
          product_id: id,
          url: input.url,
          alt_text: input.altText ?? null,
          display_order: input.displayOrder,
          created_at: new Date(),
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      if (input.isPrimary) {
        await trx
          .updateTable('products')
          .set({ image: input.url, updated_at: new Date() })
          .where('id', '=', id)
          .execute();
      }

      return img;
    });

    await audit(req, {
      action: 'admin.image.upload',
      entityType: 'product_image',
      entityId: image.id,
      newValues: { productId: id, url: input.url, isPrimary: input.isPrimary },
    });

    res.status(201).json({ data: image });
  }),
);

const reorderImagesSchema = z.object({
  imageIds: z.array(z.string().uuid()).min(1),
});

/** PATCH /api/admin/products/:id/images/reorder — reorder product gallery images. */
adminRouter.patch(
  '/products/:id/images/reorder',
  validate({ params: uuidParamSchema, body: reorderImagesSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = valid<{ id: string }>(req, 'params');
    const { imageIds } = valid<z.infer<typeof reorderImagesSchema>>(req, 'body');

    await db.transaction().execute(async (trx) => {
      for (let i = 0; i < imageIds.length; i++) {
        await trx
          .updateTable('product_images')
          .set({ display_order: i })
          .where('id', '=', imageIds[i])
          .where('product_id', '=', id)
          .execute();
      }
    });

    res.json({ data: { success: true, count: imageIds.length } });
  }),
);

const deleteImageParamSchema = z.object({
  id: z.string().uuid(),
  imageId: z.string().uuid(),
});

/** DELETE /api/admin/products/:id/images/:imageId — remove an image from product. */
adminRouter.delete(
  '/products/:id/images/:imageId',
  validate({ params: deleteImageParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { id, imageId } = valid<{ id: string; imageId: string }>(
      req,
      'params',
    );

    const deleted = await db
      .deleteFrom('product_images')
      .where('id', '=', imageId)
      .where('product_id', '=', id)
      .returningAll()
      .executeTakeFirst();

    if (!deleted) throw new AppError('NOT_FOUND', 'Product image not found');

    await audit(req, {
      action: 'admin.image.delete',
      entityType: 'product_image',
      entityId: imageId,
      oldValues: { productId: id, url: deleted.url },
    });

    res.json({ data: { success: true, id: imageId } });
  }),
);

// ============================================================================
// 4. Pricing, Discount and Inventory Management (ZYV-78)
// ============================================================================

const updatePricingSchema = z.object({
  price: z.number().int().positive(),
  compareAtPrice: z.number().int().positive().nullable().optional(),
});

/** PATCH /api/admin/products/:id/pricing — update product price and comparison price. */
adminRouter.patch(
  '/products/:id/pricing',
  validate({ params: uuidParamSchema, body: updatePricingSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = valid<{ id: string }>(req, 'params');
    const input = valid<z.infer<typeof updatePricingSchema>>(req, 'body');

    const existing = await db
      .selectFrom('products')
      .select(['id', 'price', 'compare_at_price'])
      .where('id', '=', id)
      .executeTakeFirst();

    if (!existing) throw new AppError('NOT_FOUND', 'Product not found');

    const updated = await db
      .updateTable('products')
      .set({
        price: input.price,
        compare_at_price: input.compareAtPrice !== undefined ? input.compareAtPrice : existing.compare_at_price,
        updated_at: new Date(),
      })
      .where('id', '=', id)
      .returning(['id', 'price', 'compare_at_price as compareAtPrice'])
      .executeTakeFirstOrThrow();

    await audit(req, {
      action: 'admin.product.pricing_update',
      entityType: 'product',
      entityId: id,
      oldValues: { price: existing.price, compareAtPrice: existing.compare_at_price },
      newValues: { price: updated.price, compareAtPrice: updated.compareAtPrice },
    });

    res.json({ data: updated });
  }),
);

const updateInventorySchema = z.object({
  quantity: z.number().int().min(0),
  reason: z.string().trim().max(255).optional(),
});

/** PATCH /api/admin/products/:id/inventory — adjust stock levels with audit trail. */
adminRouter.patch(
  '/products/:id/inventory',
  validate({ params: uuidParamSchema, body: updateInventorySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = valid<{ id: string }>(req, 'params');
    const input = valid<z.infer<typeof updateInventorySchema>>(req, 'body');

    const inv = await db
      .selectFrom('inventory')
      .selectAll()
      .where('product_id', '=', id)
      .executeTakeFirst();

    if (!inv) throw new AppError('NOT_FOUND', 'Inventory row not found for product');

    const updated = await db
      .updateTable('inventory')
      .set({
        quantity: input.quantity,
        updated_at: new Date(),
      })
      .where('product_id', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow();

    await audit(req, {
      action: 'admin.inventory.stock_adjustment',
      entityType: 'inventory',
      entityId: inv.id,
      oldValues: { quantity: inv.quantity },
      newValues: { quantity: updated.quantity, reason: input.reason ?? 'manual adjustment' },
    });

    res.json({ data: updated });
  }),
);

// Coupons CRUD for discounts (ZYV-78)
const couponListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  status: z.enum(['all', 'active', 'inactive']).default('all'),
});

adminRouter.get(
  '/coupons',
  validate({ query: couponListQuerySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { page, limit, status } = valid<z.infer<typeof couponListQuerySchema>>(
      req,
      'query',
    );
    const offset = (page - 1) * limit;

    let query = db.selectFrom('coupons').selectAll();
    if (status === 'active') {
      query = query.where('is_active', '=', true);
    } else if (status === 'inactive') {
      query = query.where('is_active', '=', false);
    }

    const rows = await query
      .orderBy('created_at', 'desc')
      .limit(limit)
      .offset(offset)
      .execute();

    res.json({ data: rows });
  }),
);

const createCouponSchema = z.object({
  code: z.string().trim().min(3).max(50).toUpperCase(),
  discountType: z.enum(['percentage', 'fixed']),
  discountValue: z.number().int().positive(),
  minOrderAmount: z.number().int().min(0).nullable().optional(),
  maxDiscount: z.number().int().min(0).nullable().optional(),
  usageLimit: z.number().int().min(1).nullable().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
  isActive: z.boolean().default(true),
});

adminRouter.post(
  '/coupons',
  validate({ body: createCouponSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const input = valid<z.infer<typeof createCouponSchema>>(req, 'body');

    const created = await db
      .insertInto('coupons')
      .values({
        code: input.code,
        discount_type: input.discountType,
        discount_value: input.discountValue,
        min_order_amount: input.minOrderAmount ?? null,
        max_discount: input.maxDiscount ?? null,
        usage_limit: input.usageLimit ?? null,
        used_count: 0,
        starts_at: new Date(),
        expires_at: input.expiresAt ? new Date(input.expiresAt) : null,
        is_active: input.isActive,
        created_at: new Date(),
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    await audit(req, {
      action: 'admin.coupon.create',
      entityType: 'coupon',
      entityId: created.id,
      newValues: { code: created.code, discountValue: created.discount_value },
    });

    res.status(201).json({ data: created });
  }),
);

adminRouter.delete(
  '/coupons/:id',
  validate({ params: uuidParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = valid<{ id: string }>(req, 'params');

    const updated = await db
      .updateTable('coupons')
      .set({ is_active: false })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirst();

    if (!updated) throw new AppError('NOT_FOUND', 'Coupon not found');

    await audit(req, {
      action: 'admin.coupon.deactivate',
      entityType: 'coupon',
      entityId: id,
    });

    res.json({ data: { id, isActive: false } });
  }),
);

// ============================================================================
// 5. Admin Order Search & Filtering (ZYV-81) & Status Transitions (ZYV-85)
// ============================================================================

const orderListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().optional(),
  status: z.string().trim().optional(),
  fromDate: z.string().optional(),
  toDate: z.string().optional(),
});

/** GET /api/admin/orders — search, filter, and paginate orders. */
adminRouter.get(
  '/orders',
  validate({ query: orderListQuerySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { page, limit, search, status, fromDate, toDate } = valid<
      z.infer<typeof orderListQuerySchema>
    >(req, 'query');
    const offset = (page - 1) * limit;

    let baseQuery = db
      .selectFrom('orders')
      .innerJoin('users', 'users.id', 'orders.user_id');

    if (status) {
      baseQuery = baseQuery.where('orders.status', '=', status);
    }
    if (fromDate) {
      baseQuery = baseQuery.where('orders.created_at', '>=', new Date(fromDate));
    }
    if (toDate) {
      baseQuery = baseQuery.where('orders.created_at', '<=', new Date(toDate));
    }
    if (search) {
      const pattern = `%${search}%`;
      baseQuery = baseQuery.where((eb) =>
        eb.or([
          eb('users.email', 'ilike', pattern),
          eb('users.full_name', 'ilike', pattern),
          eb('users.mobile', 'ilike', pattern),
          eb(sql`orders.id::text`, 'ilike', pattern),
        ]),
      );
    }

    const countResult = await baseQuery
      .select((eb) => eb.fn.count('orders.id').as('count'))
      .executeTakeFirst();
    const total = Number(countResult?.count ?? 0);

    const rows = await baseQuery
      .select([
        'orders.id',
        'orders.user_id as userId',
        'users.email as customerEmail',
        'users.full_name as customerName',
        'users.mobile as customerMobile',
        'orders.subtotal',
        'orders.shipping',
        'orders.tax',
        'orders.discount',
        'orders.total',
        'orders.status',
        'orders.created_at as createdAt',
        'orders.updated_at as updatedAt',
      ])
      .orderBy('orders.created_at', 'desc')
      .limit(limit)
      .offset(offset)
      .execute();

    res.json({
      data: rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  }),
);

/** GET /api/admin/orders/:id — full order detail with items, customer and payment info. */
adminRouter.get(
  '/orders/:id',
  validate({ params: uuidParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = valid<{ id: string }>(req, 'params');

    const order = await db
      .selectFrom('orders')
      .innerJoin('users', 'users.id', 'orders.user_id')
      .select([
        'orders.id',
        'orders.user_id as userId',
        'users.email as customerEmail',
        'users.full_name as customerName',
        'users.mobile as customerMobile',
        'orders.subtotal',
        'orders.shipping',
        'orders.tax',
        'orders.discount',
        'orders.total',
        'orders.status',
        'orders.created_at as createdAt',
        'orders.updated_at as updatedAt',
      ])
      .where('orders.id', '=', id)
      .executeTakeFirst();

    if (!order) throw new AppError('NOT_FOUND', 'Order not found');

    const items = await db
      .selectFrom('order_items')
      .selectAll()
      .where('order_id', '=', id)
      .execute();

    const payment = await db
      .selectFrom('payments')
      .select(['id', 'amount', 'currency', 'status', 'method', 'created_at as createdAt'])
      .where('order_id', '=', id)
      .executeTakeFirst();

    const shipment = await db
      .selectFrom('shipments')
      .selectAll()
      .where('order_id', '=', id)
      .executeTakeFirst();

    res.json({
      data: {
        ...order,
        items,
        payment: payment ?? null,
        shipment: shipment ?? null,
      },
    });
  }),
);

// Valid state machine transitions (ZYV-85)
const VALID_ORDER_TRANSITIONS: Record<string, string[]> = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['processing', 'cancelled'],
  processing: ['shipped', 'cancelled'],
  shipped: ['delivered', 'returned'],
  delivered: ['returned'],
  cancelled: [],
  returned: [],
};

const updateOrderStatusSchema = z.object({
  status: z.string().trim().toLowerCase(),
  note: z.string().trim().max(500).optional(),
});

/** PATCH /api/admin/orders/:id/status — enforce valid status transitions only (ZYV-85). */
adminRouter.patch(
  '/orders/:id/status',
  validate({ params: uuidParamSchema, body: updateOrderStatusSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = valid<{ id: string }>(req, 'params');
    const { status: targetStatus, note } = valid<
      z.infer<typeof updateOrderStatusSchema>
    >(req, 'body');

    const order = await db
      .selectFrom('orders')
      .select(['id', 'status'])
      .where('id', '=', id)
      .executeTakeFirst();

    if (!order) throw new AppError('NOT_FOUND', 'Order not found');

    const currentStatus = order.status.toLowerCase();
    const allowed = VALID_ORDER_TRANSITIONS[currentStatus] || [];

    if (!allowed.includes(targetStatus)) {
      throw new AppError(
        'BAD_REQUEST',
        `Invalid status transition: cannot move order from '${currentStatus}' to '${targetStatus}'. Allowed transitions: ${allowed.join(', ') || 'none (terminal state)'}`,
      );
    }

    const updated = await db
      .updateTable('orders')
      .set({ status: targetStatus, updated_at: new Date() })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow();

    await audit(req, {
      action: 'order.status_changed',
      entityType: 'order',
      entityId: id,
      oldValues: { status: currentStatus },
      newValues: { status: targetStatus, note: note ?? null },
    });

    res.json({ data: updated });
  }),
);

// ============================================================================
// 6. Admin Sales and Order Reports (ZYV-95)
// ============================================================================

function toCsv(
  headers: string[],
  rows: (string | number | boolean | null | undefined)[][],
): string {
  const escapeCell = (val: unknown) => {
    if (val === null || val === undefined) return '""';
    const s = String(val).replace(/"/g, '""');
    return `"${s}"`;
  };
  const headerLine = headers.map(escapeCell).join(',');
  const rowLines = rows.map((r) => r.map(escapeCell).join(','));
  return [headerLine, ...rowLines].join('\n');
}

const reportQuerySchema = z.object({
  format: z.enum(['json', 'csv']).default('json'),
  period: z.enum(['day', 'week', 'month', 'year', 'all']).default('all'),
});

/** GET /api/admin/reports/summary — sales revenue and order counts. */
adminRouter.get(
  '/reports/summary',
  validate({ query: reportQuerySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { format, period } = valid<z.infer<typeof reportQuerySchema>>(
      req,
      'query',
    );

    let query = db.selectFrom('orders');
    if (period !== 'all') {
      const now = new Date();
      let since = new Date();
      if (period === 'day') since.setDate(now.getDate() - 1);
      else if (period === 'week') since.setDate(now.getDate() - 7);
      else if (period === 'month') since.setMonth(now.getMonth() - 1);
      else if (period === 'year') since.setFullYear(now.getFullYear() - 1);
      query = query.where('created_at', '>=', since);
    }

    const stats = await query
      .select([
        (eb) => eb.fn.count('id').as('totalOrders'),
        (eb) => eb.fn.sum('total').as('totalRevenue'),
        (eb) => eb.fn.avg('total').as('averageOrderValue'),
      ])
      .executeTakeFirst();

    const totalOrders = Number(stats?.totalOrders ?? 0);
    const totalRevenue = Number(stats?.totalRevenue ?? 0);
    const avgOrderValue = Math.round(Number(stats?.averageOrderValue ?? 0));

    if (format === 'csv') {
      const csv = toCsv(
        ['Metric', 'Value', 'Period'],
        [
          ['Total Orders', totalOrders, period],
          ['Total Revenue (INR)', totalRevenue, period],
          ['Average Order Value (INR)', avgOrderValue, period],
        ],
      );
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="sales-summary-${period}.csv"`,
      );
      res.send(csv);
      return;
    }

    res.json({
      data: {
        period,
        totalOrders,
        totalRevenue,
        averageOrderValue: avgOrderValue,
      },
    });
  }),
);

const topProductsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(10),
  format: z.enum(['json', 'csv']).default('json'),
});

/** GET /api/admin/reports/top-products — top selling products by volume and revenue. */
adminRouter.get(
  '/reports/top-products',
  validate({ query: topProductsQuerySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { limit, format } = valid<z.infer<typeof topProductsQuerySchema>>(
      req,
      'query',
    );

    const rows = await db
      .selectFrom('order_items')
      .select([
        'order_items.product_id as productId',
        'order_items.name as productName',
        (eb) => eb.fn.sum('order_items.quantity').as('unitsSold'),
        (eb) =>
          eb.fn
            .sum(sql`order_items.unit_price * order_items.quantity`)
            .as('totalRevenue'),
      ])
      .groupBy(['order_items.product_id', 'order_items.name'])
      .orderBy('unitsSold', 'desc')
      .limit(limit)
      .execute();

    const formatted = rows.map((r) => ({
      productId: r.productId,
      productName: r.productName,
      unitsSold: Number(r.unitsSold ?? 0),
      totalRevenue: Number(r.totalRevenue ?? 0),
    }));

    if (format === 'csv') {
      const csv = toCsv(
        ['Product ID', 'Product Name', 'Units Sold', 'Total Revenue (INR)'],
        formatted.map((p) => [
          p.productId,
          p.productName,
          p.unitsSold,
          p.totalRevenue,
        ]),
      );
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader(
        'Content-Disposition',
        'attachment; filename="top-products.csv"',
      );
      res.send(csv);
      return;
    }

    res.json({ data: formatted });
  }),
);

const lowStockQuerySchema = z.object({
  threshold: z.coerce.number().int().min(0).max(500).default(10),
  format: z.enum(['json', 'csv']).default('json'),
});

/** GET /api/admin/reports/low-stock — inventory alert for low or depleted products. */
adminRouter.get(
  '/reports/low-stock',
  validate({ query: lowStockQuerySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { threshold, format } = valid<z.infer<typeof lowStockQuerySchema>>(
      req,
      'query',
    );

    const rows = await db
      .selectFrom('inventory')
      .innerJoin('products', 'products.id', 'inventory.product_id')
      .select([
        'products.id as productId',
        'products.name as productName',
        'inventory.quantity as stock',
        'inventory.reserved_quantity as reservedStock',
        'products.is_active as isActive',
      ])
      .where('inventory.quantity', '<=', threshold)
      .orderBy('inventory.quantity', 'asc')
      .execute();

    if (format === 'csv') {
      const csv = toCsv(
        ['Product ID', 'Product Name', 'Stock', 'Reserved', 'Is Active'],
        rows.map((p) => [
          p.productId,
          p.productName,
          p.stock,
          p.reservedStock,
          p.isActive,
        ]),
      );
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader(
        'Content-Disposition',
        'attachment; filename="low-stock.csv"',
      );
      res.send(csv);
      return;
    }

    res.json({ data: rows, meta: { threshold } });
  }),
);

// ============================================================================
// 7. Manage Customer Accounts (ZYV-86)
// ============================================================================

const customerListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().optional(),
});

/** GET /api/admin/customers — search and view customer accounts (no password hash exposed). */
adminRouter.get(
  '/customers',
  validate({ query: customerListQuerySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { page, limit, search } = valid<
      z.infer<typeof customerListQuerySchema>
    >(req, 'query');
    const offset = (page - 1) * limit;

    let baseQuery = db
      .selectFrom('users')
      .innerJoin('roles', 'roles.id', 'users.role_id')
      .where('roles.name', '=', 'customer');

    if (search) {
      const pattern = `%${search}%`;
      baseQuery = baseQuery.where((eb) =>
        eb.or([
          eb('users.email', 'ilike', pattern),
          eb('users.full_name', 'ilike', pattern),
          eb('users.mobile', 'ilike', pattern),
        ]),
      );
    }

    const countResult = await baseQuery
      .select((eb) => eb.fn.count('users.id').as('count'))
      .executeTakeFirst();
    const total = Number(countResult?.count ?? 0);

    const rows = await baseQuery
      .select([
        'users.id',
        'users.email',
        'users.full_name as fullName',
        'users.mobile',
        'users.created_at as createdAt',
        'roles.name as role',
      ])
      .orderBy('users.created_at', 'desc')
      .limit(limit)
      .offset(offset)
      .execute();

    res.json({
      data: rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  }),
);

/** GET /api/admin/customers/:id — view single customer profile. */
adminRouter.get(
  '/customers/:id',
  validate({ params: uuidParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = valid<{ id: string }>(req, 'params');

    const user = await db
      .selectFrom('users')
      .innerJoin('roles', 'roles.id', 'users.role_id')
      .select([
        'users.id',
        'users.email',
        'users.full_name as fullName',
        'users.mobile',
        'users.created_at as createdAt',
        'roles.name as role',
      ])
      .where('users.id', '=', id)
      .executeTakeFirst();

    if (!user) throw new AppError('NOT_FOUND', 'Customer account not found');

    const ordersCount = await db
      .selectFrom('orders')
      .select((eb) => eb.fn.count('id').as('count'))
      .where('user_id', '=', id)
      .executeTakeFirst();

    res.json({
      data: {
        ...user,
        totalOrders: Number(ordersCount?.count ?? 0),
      },
    });
  }),
);

/** GET /api/admin/customers/:id/orders — view a specific customer's order history. */
adminRouter.get(
  '/customers/:id/orders',
  validate({ params: uuidParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = valid<{ id: string }>(req, 'params');

    const customer = await db
      .selectFrom('users')
      .select('id')
      .where('id', '=', id)
      .executeTakeFirst();

    if (!customer) throw new AppError('NOT_FOUND', 'Customer account not found');

    const orders = await db
      .selectFrom('orders')
      .selectAll()
      .where('user_id', '=', id)
      .orderBy('created_at', 'desc')
      .execute();

    res.json({ data: orders });
  }),
);

// ============================================================================
// 8. Manage Banners, Policies & Content (ZYV-93)
// ============================================================================

/** GET /api/admin/banners — list promotional banners. */
adminRouter.get(
  '/banners',
  asyncHandler(async (_req: Request, res: Response) => {
    const rows = await db
      .selectFrom('banners')
      .selectAll()
      .orderBy('display_order', 'asc')
      .execute();

    res.json({ data: rows });
  }),
);

const createBannerSchema = z.object({
  title: z.string().trim().min(1).max(255),
  imageUrl: z.string().url(),
  linkUrl: z.string().url().nullable().optional(),
  displayOrder: z.number().int().default(0),
  isActive: z.boolean().default(true),
});

/** POST /api/admin/banners — create promotional banner. */
adminRouter.post(
  '/banners',
  validate({ body: createBannerSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const input = valid<z.infer<typeof createBannerSchema>>(req, 'body');

    const banner = await db
      .insertInto('banners')
      .values({
        title: input.title,
        image_url: input.imageUrl,
        link_url: input.linkUrl ?? null,
        display_order: input.displayOrder,
        is_active: input.isActive,
        created_at: new Date(),
        updated_at: new Date(),
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    await audit(req, {
      action: 'admin.banner.create',
      entityType: 'banner',
      entityId: banner.id,
      newValues: { title: banner.title },
    });

    res.status(201).json({ data: banner });
  }),
);

adminRouter.delete(
  '/banners/:id',
  validate({ params: uuidParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = valid<{ id: string }>(req, 'params');

    const deleted = await db
      .deleteFrom('banners')
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirst();

    if (!deleted) throw new AppError('NOT_FOUND', 'Banner not found');

    await audit(req, {
      action: 'admin.banner.delete',
      entityType: 'banner',
      entityId: id,
    });

    res.json({ data: { id, deleted: true } });
  }),
);

/** GET /api/admin/content — list editable policy content blocks. */
adminRouter.get(
  '/content',
  asyncHandler(async (_req: Request, res: Response) => {
    const rows = await db
      .selectFrom('content_blocks')
      .selectAll()
      .orderBy('slug', 'asc')
      .execute();

    res.json({ data: rows });
  }),
);

const updateContentBlockSchema = z.object({
  title: z.string().trim().min(2).max(255).optional(),
  body: z.string().trim().min(1),
});

/** PUT /api/admin/content/:slug — edit policy page content. */
adminRouter.put(
  '/content/:slug',
  validate({
    params: z.object({ slug: z.string().trim().min(2).max(100) }),
    body: updateContentBlockSchema,
  }),
  asyncHandler(async (req: Request, res: Response) => {
    const { slug } = valid<{ slug: string }>(req, 'params');
    const input = valid<z.infer<typeof updateContentBlockSchema>>(req, 'body');

    const existing = await db
      .selectFrom('content_blocks')
      .selectAll()
      .where('slug', '=', slug)
      .executeTakeFirst();

    if (!existing) throw new AppError('NOT_FOUND', 'Content block not found');

    const updated = await db
      .updateTable('content_blocks')
      .set({
        title: input.title ?? existing.title,
        body: input.body,
        updated_at: new Date(),
      })
      .where('slug', '=', slug)
      .returningAll()
      .executeTakeFirstOrThrow();

    await audit(req, {
      action: 'admin.content.update',
      entityType: 'content_block',
      entityId: existing.id,
      oldValues: { slug, title: existing.title },
      newValues: { title: updated.title },
    });

    res.json({ data: updated });
  }),
);

// ============================================================================
// 9. Payment Status & Refund Requests (Database-scoped, No Razorpay) (ZYV-91)
// ============================================================================

const paymentListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.string().trim().optional(),
});

/** GET /api/admin/payments — view recorded payment statuses (no raw cards). */
adminRouter.get(
  '/payments',
  validate({ query: paymentListQuerySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { page, limit, status } = valid<
      z.infer<typeof paymentListQuerySchema>
    >(req, 'query');
    const offset = (page - 1) * limit;

    let query = db
      .selectFrom('payments')
      .innerJoin('orders', 'orders.id', 'payments.order_id')
      .select([
        'payments.id',
        'payments.order_id as orderId',
        'payments.amount',
        'payments.currency',
        'payments.status',
        'payments.method',
        'payments.created_at as createdAt',
        'orders.total as orderTotal',
      ]);

    if (status) {
      query = query.where('payments.status', '=', status);
    }

    const rows = await query
      .orderBy('payments.created_at', 'desc')
      .limit(limit)
      .offset(offset)
      .execute();

    res.json({ data: rows });
  }),
);

/** GET /api/admin/refunds — view recorded refund requests. */
adminRouter.get(
  '/refunds',
  asyncHandler(async (_req: Request, res: Response) => {
    const rows = await db
      .selectFrom('refunds')
      .innerJoin('payments', 'payments.id', 'refunds.payment_id')
      .select([
        'refunds.id',
        'refunds.payment_id as paymentId',
        'payments.order_id as orderId',
        'refunds.amount',
        'refunds.reason',
        'refunds.status',
        'refunds.created_at as createdAt',
      ])
      .orderBy('refunds.created_at', 'desc')
      .execute();

    res.json({ data: rows });
  }),
);

const updateRefundStatusSchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected']),
  note: z.string().trim().optional(),
});

/** PATCH /api/admin/refunds/:id/status — update refund request status in DB (no payment gateway). */
adminRouter.patch(
  '/refunds/:id/status',
  validate({ params: uuidParamSchema, body: updateRefundStatusSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = valid<{ id: string }>(req, 'params');
    const input = valid<z.infer<typeof updateRefundStatusSchema>>(req, 'body');

    const refund = await db
      .selectFrom('refunds')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();

    if (!refund) throw new AppError('NOT_FOUND', 'Refund record not found');

    const updated = await db
      .updateTable('refunds')
      .set({ status: input.status })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow();

    await audit(req, {
      action: 'admin.refund.status_update',
      entityType: 'refund',
      entityId: id,
      oldValues: { status: refund.status },
      newValues: { status: input.status, note: input.note ?? null },
    });

    res.json({ data: updated });
  }),
);
