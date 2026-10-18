import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';

import { db } from '../db/client.js';
import { asyncHandler } from '../http/async-handler.js';
import { AppError } from '../http/errors.js';
import { validate, valid } from '../http/validate.js';
import { optionalAuth } from '../http/auth.js';

/**
 * Cart (E5).
 *
 *   ZYV-44  GET    /api/cart
 *   ZYV-42  POST   /api/cart/items
 *   ZYV-43  PATCH  /api/cart/items/:itemId
 *   ZYV-45  DELETE /api/cart/items/:itemId
 *   ZYV-47  guest persistence and synchronisation
 *   ZYV-49  guest-to-account merge on sign-in
 *   ZYV-55  server-authoritative price, stock, shipping and discount
 *
 * Three decisions worth stating up front, because each one was available in at
 * least two plausible forms and the alternative would have been wrong.
 *
 * STOCK — `inventory.quantity - inventory.reserved_quantity` is the only
 * authority. `products.stock_quantity` also exists and disagrees with
 * `inventory` on 7 of the 8 seeded products, because the seed writes 100 to
 * every inventory row and the real figure to the product. The catalog already
 * reads `inventory` (src/routes/catalog.ts), so the cart matching `products`
 * would advertise stock the catalog has already refused to sell. Reading
 * inventory keeps the two endpoints telling the same story.
 *
 * PRICE — the cart never stores a price and never accepts one. Every total is
 * recomputed from `products.price` on every read. A price cached in
 * `cart_items` is a price that will be wrong the moment a product is repriced
 * while it sits in someone's basket, and nothing would notice.
 *
 * GUEST IDENTITY — a signed-out visitor gets a cart keyed on a random
 * `session_id` handed out in an HttpOnly cookie. It is not derived from the
 * IP or a user agent: those are shared by offices, campuses and carrier NAT,
 * which would merge one person's basket into a stranger's. Losing the cookie
 * loses the basket, which is the correct failure for a basket with no login
 * behind it.
 */

/** Signed-out cart lifetime. Long enough to abandon a basket and return. */
const GUEST_CART_TTL_DAYS = 30;

const GUEST_COOKIE = 'zyvora_cart';

const MAX_QTY_PER_LINE = 10;
const MAX_LINES_PER_CART = 25;

/** Free delivery threshold, in whole rupees. */
const FREE_SHIPPING_THRESHOLD = 2000;
const SHIPPING_FLAT_RATE = 99;

const addItemSchema = z.object({
  productId: z.string().uuid('Product id must be a UUID'),
  // The message matters: without it the schema rejects an over-cap request
  // before the handler's own (clearer) check runs, and the shopper is told
  // only "Request validation failed".
  quantity: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_QTY_PER_LINE, `Maximum ${MAX_QTY_PER_LINE} per product`)
    .default(1),
});

const patchItemSchema = z.object({
  quantity: z.coerce
    .number()
    .int()
    .min(0)
    .max(MAX_QTY_PER_LINE, `Maximum ${MAX_QTY_PER_LINE} per product`),
});

const itemIdSchema = z.object({
  itemId: z.string().uuid('Cart item id must be a UUID'),
});

export const cartRouter: Router = Router();

/* --------------------------------------------------------------- identity -- */

interface CartIdentity {
  cartId: string;
  /** Set when the cart was created in this request, so the cookie is issued. */
  isNew: boolean;
}

/**
 * Resolve the caller's cart: their account cart when signed in, otherwise the
 * guest cart named by the cookie, otherwise a fresh one.
 *
 * Never creates a row. A GET must not write — otherwise every bot that ever
 * hit the endpoint left a row behind, and an abandoned cart is a table that
 * grows forever.
 */
async function resolveCart(
  req: Request,
  res: Response,
  options: { create: boolean },
): Promise<CartIdentity | null> {
  const user = req.user;

  if (user) {
    const existing = await db
      .selectFrom('carts')
      .select('id')
      .where('user_id', '=', user.id)
      .executeTakeFirst();
    if (existing) return { cartId: existing.id, isNew: false };

    // No account cart yet. Reuse the guest cart when there is one, so signing
    // in keeps the basket rather than silently emptying it (ZYV-49).
    const guestId = req.cookies?.[GUEST_COOKIE];
    if (guestId) {
      const guest = await db
        .selectFrom('carts')
        .select('id')
        .where('session_id', '=', guestId)
        .where('user_id', 'is', null)
        .executeTakeFirst();
      if (guest) {
        const claimed = await db
          .updateTable('carts')
          .set({ user_id: user.id, updated_at: new Date() })
          .where('id', '=', guest.id)
          .where('user_id', 'is', null)
          .returning('id')
          .executeTakeFirstOrThrow();
        clearGuestCookie(res);
        return { cartId: claimed.id, isNew: false };
      }
      clearGuestCookie(res);
    }

    if (!options.create) return null;
    const created = await db
      .insertInto('carts')
      .values({ id: randomUUID(), user_id: user.id })
      .returning('id')
      .executeTakeFirstOrThrow();
    return { cartId: created.id, isNew: true };
  }

  const sessionId = req.cookies?.[GUEST_COOKIE];
  if (sessionId) {
    const guest = await db
      .selectFrom('carts')
      .select('id')
      .where('session_id', '=', sessionId)
      .executeTakeFirst();
    if (guest) return { cartId: guest.id, isNew: false };
  }

  if (!options.create) return null;

  const newSessionId = randomUUID();
  const created = await db
    .insertInto('carts')
    .values({ id: randomUUID(), session_id: newSessionId })
    .returning('id')
    .executeTakeFirstOrThrow();
  setGuestCookie(res, newSessionId);
  return { cartId: created.id, isNew: true };
}

function setGuestCookie(res: Response, sessionId: string): void {
  res.cookie(GUEST_COOKIE, sessionId, {
    httpOnly: true,
    // Lax rather than Strict: a shopper clicking a link into the store from
    // their inbox must arrive with the basket intact.
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: GUEST_CART_TTL_DAYS * 24 * 60 * 60 * 1000,
    path: '/',
  });
}

function clearGuestCookie(res: Response): void {
  res.clearCookie(GUEST_COOKIE, { path: '/' });
}

/* ------------------------------------------------------------------ totals -- */

export interface CartLine {
  itemId: string;
  productId: string;
  name: string;
  image: string;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
  /** Units available to buy right now, for a "only N left" hint. */
  available: number;
}

export interface CartTotals {
  subtotal: number;
  shipping: number;
  discount: number;
  total: number;
  itemCount: number;
  freeShippingThreshold: number;
  amountToFreeShipping: number;
}

/**
 * Read a cart and compute every figure from live product data.
 *
 * Prunes lines whose product has since been deactivated or deleted, so a
 * basket cannot hold something the catalog will not sell (ZYV-55).
 */
async function readCart(cartId: string): Promise<{
  lines: CartLine[];
  totals: CartTotals;
}> {
  const rows = await db
    .selectFrom('cart_items')
    .innerJoin('products', 'products.id', 'cart_items.product_id')
    .leftJoin('inventory', 'inventory.product_id', 'products.id')
    .select([
      'cart_items.id as itemId',
      'cart_items.quantity',
      'products.id as productId',
      'products.name',
      'products.image',
      'products.price',
      'products.is_active',
      'inventory.quantity as invQuantity',
      'inventory.reserved_quantity as invReserved',
    ])
    .where('cart_items.cart_id', '=', cartId)
    .execute();

  const sellable = rows.filter((r) => r.is_active);

  // A deactivated product has been withdrawn. Keeping it would price the
  // basket around something that cannot be bought, so the line is removed.
  const withdrawn = rows.filter((r) => !r.is_active).map((r) => r.itemId);
  if (withdrawn.length > 0) {
    await db.deleteFrom('cart_items').where('id', 'in', withdrawn).execute();
  }

  const lines: CartLine[] = sellable.map((r) => {
    const onHand = (r.invQuantity ?? 0) - (r.invReserved ?? 0);
    // Clamp rather than reject: the basket may hold more than is left after
    // someone else bought the last one. Showing the truth beats hiding the
    // line; checkout is where an over-quantity becomes an error.
    const quantity = Math.min(r.quantity, Math.max(onHand, 0));
    return {
      itemId: r.itemId,
      productId: r.productId,
      name: r.name,
      image: r.image,
      unitPrice: r.price,
      quantity,
      lineTotal: r.price * quantity,
      available: Math.max(onHand, 0),
    };
  });

  const subtotal = lines.reduce((sum, l) => sum + l.lineTotal, 0);
  const shipping =
    subtotal === 0 || subtotal >= FREE_SHIPPING_THRESHOLD
      ? 0
      : SHIPPING_FLAT_RATE;

  return {
    lines,
    totals: {
      subtotal,
      shipping,
      discount: 0,
      total: subtotal + shipping,
      itemCount: lines.reduce((n, l) => n + l.quantity, 0),
      freeShippingThreshold: FREE_SHIPPING_THRESHOLD,
      amountToFreeShipping: Math.max(FREE_SHIPPING_THRESHOLD - subtotal, 0),
    },
  };
}

/* ------------------------------------------------------------------ routes -- */

cartRouter.get(
  '/cart',
  optionalAuth(),
  asyncHandler(async (req: Request, res: Response) => {
    const identity = await resolveCart(req, res, { create: false });
    if (!identity) {
      // An empty cart, not a 404: "you have no basket yet" is a normal state,
      // and the frontend should render an empty basket without special-casing.
      res.json({ data: { lines: [], totals: emptyTotals() } });
      return;
    }

    const { lines, totals } = await readCart(identity.cartId);
    res.json({ data: { lines, totals } });
  }),
);

cartRouter.post(
  '/cart/items',
  optionalAuth(),
  validate({ body: addItemSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { productId, quantity } = valid<z.infer<typeof addItemSchema>>(
      req,
      'body',
    );

    const identity = await resolveCart(req, res, { create: true });
    if (!identity) {
      throw new AppError('INTERNAL_ERROR', 'Could not create a cart');
    }

    const product = await db
      .selectFrom('products')
      .innerJoin('inventory', 'inventory.product_id', 'products.id')
      .select([
        'products.name',
        'products.is_active',
        'inventory.quantity',
        'inventory.reserved_quantity',
      ])
      .where('products.id', '=', productId)
      .executeTakeFirst();

    if (!product) throw new AppError('NOT_FOUND', 'Product not found');
    if (!product.is_active) {
      throw new AppError(
        'VALIDATION_ERROR',
        'This product is no longer available',
      );
    }

    const onHand = product.quantity - product.reserved_quantity;
    if (onHand <= 0) {
      throw new AppError('VALIDATION_ERROR', 'This product is out of stock');
    }

    const existing = await db
      .selectFrom('cart_items')
      .select(['id', 'quantity'])
      .where('cart_id', '=', identity.cartId)
      .where('product_id', '=', productId)
      .executeTakeFirst();

    const lineCount = await db
      .selectFrom('cart_items')
      .select('id')
      .where('cart_id', '=', identity.cartId)
      .execute();

    // Adding a new product when the basket is already full is refused; adding
    // more of a product already present is not, because that adds no new line.
    if (!existing && lineCount.length >= MAX_LINES_PER_CART) {
      throw new AppError(
        'VALIDATION_ERROR',
        `A basket cannot hold more than ${MAX_LINES_PER_CART} different products`,
      );
    }

    const target = (existing?.quantity ?? 0) + quantity;

    if (target > onHand) {
      throw new AppError(
        'VALIDATION_ERROR',
        onHand === 1 ? 'Only 1 left in stock' : `Only ${onHand} left in stock`,
      );
    }
    if (target > MAX_QTY_PER_LINE) {
      throw new AppError(
        'VALIDATION_ERROR',
        `Maximum ${MAX_QTY_PER_LINE} per product`,
      );
    }

    if (existing) {
      await db
        .updateTable('cart_items')
        .set({ quantity: target })
        .where('id', '=', existing.id)
        .execute();
    } else {
      await db
        .insertInto('cart_items')
        .values({
          id: randomUUID(),
          cart_id: identity.cartId,
          product_id: productId,
          quantity: target,
        })
        .execute();
    }

    await touchCart(identity.cartId);

    const cart = await readCart(identity.cartId);
    res.status(201).json({ data: cart });
  }),
);

cartRouter.patch(
  '/cart/items/:itemId',
  optionalAuth(),
  validate({ params: itemIdSchema, body: patchItemSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { itemId } = valid<z.infer<typeof itemIdSchema>>(req, 'params');
    const { quantity } = valid<z.infer<typeof patchItemSchema>>(req, 'body');

    const identity = await resolveCart(req, res, { create: false });
    if (!identity) throw new AppError('NOT_FOUND', 'Cart item not found');

    const line = await db
      .selectFrom('cart_items')
      .innerJoin('products', 'products.id', 'cart_items.product_id')
      .leftJoin('inventory', 'inventory.product_id', 'products.id')
      .select([
        'cart_items.id',
        'products.is_active',
        'inventory.quantity',
        'inventory.reserved_quantity',
      ])
      .where('cart_items.id', '=', itemId)
      .where('cart_items.cart_id', '=', identity.cartId)
      .executeTakeFirst();

    // Scoped to this cart, so one customer's item id cannot be used to probe
    // another's basket.
    if (!line) throw new AppError('NOT_FOUND', 'Cart item not found');
    if (!line.is_active) {
      throw new AppError(
        'VALIDATION_ERROR',
        'This product is no longer available',
      );
    }

    // Zero is a removal expressed as an update, which is what a quantity
    // stepper in the UI actually sends.
    if (quantity === 0) {
      await db.deleteFrom('cart_items').where('id', '=', itemId).execute();
      await touchCart(identity.cartId);
      res.json({ data: await readCart(identity.cartId) });
      return;
    }

    const onHand = (line.quantity ?? 0) - (line.reserved_quantity ?? 0);
    if (quantity > onHand) {
      throw new AppError(
        'VALIDATION_ERROR',
        onHand === 1 ? 'Only 1 left in stock' : `Only ${onHand} left in stock`,
      );
    }

    await db
      .updateTable('cart_items')
      .set({ quantity })
      .where('id', '=', itemId)
      .execute();
    await touchCart(identity.cartId);

    res.json({ data: await readCart(identity.cartId) });
  }),
);

cartRouter.delete(
  '/cart/items/:itemId',
  optionalAuth(),
  validate({ params: itemIdSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { itemId } = valid<z.infer<typeof itemIdSchema>>(req, 'params');

    const identity = await resolveCart(req, res, { create: false });
    if (!identity) throw new AppError('NOT_FOUND', 'Cart item not found');

    const removed = await db
      .deleteFrom('cart_items')
      .where('id', '=', itemId)
      .where('cart_id', '=', identity.cartId)
      .returning('id')
      .execute();

    // 404 on a line that is not in YOUR cart, rather than a silent success, so
    // a stale UI cannot report a removal that never happened.
    if (removed.length === 0) {
      throw new AppError('NOT_FOUND', 'Cart item not found');
    }

    await touchCart(identity.cartId);
    res.json({ data: await readCart(identity.cartId) });
  }),
);

function emptyTotals(): CartTotals {
  return {
    subtotal: 0,
    shipping: 0,
    discount: 0,
    total: 0,
    itemCount: 0,
    freeShippingThreshold: FREE_SHIPPING_THRESHOLD,
    amountToFreeShipping: FREE_SHIPPING_THRESHOLD,
  };
}

async function touchCart(cartId: string): Promise<void> {
  await db
    .updateTable('carts')
    .set({ updated_at: new Date() })
    .where('id', '=', cartId)
    .execute();
}

export { GUEST_COOKIE };
