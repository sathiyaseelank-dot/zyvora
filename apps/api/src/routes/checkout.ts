import { Router, type Request, type Response } from 'express';
import { z } from 'zod';

import { db } from '../db/client.js';
import { asyncHandler } from '../http/async-handler.js';
import { validate, valid } from '../http/validate.js';
import { optionalAuth, requireAuth } from '../http/auth.js';
import { limiters } from '../http/rate-limit.js';

/**
 * Checkout validation (ZYV-59).
 *
 *   POST /api/checkout/validate
 *
 * The step between "here is a basket" and "create an order". It answers one
 * question: could this order be placed right now, and for how much? It creates
 * nothing — no order, no payment, no reservation. E8 creates the payment and
 * E9 the order; this exists so the checkout screens have something authoritative
 * to render, and so an impossible basket is refused before a shopper is walked
 * through three steps to a failure.
 *
 * Three reasons it recomputes rather than trusting the client:
 *
 *  - The basket may have changed since it was rendered. Two tabs, a shared
 *    link, a night between reviewing and paying.
 *  - Price, stock and shipping are the server's. A client that could report
 *    its own total could report any total.
 *  - Nothing here is a promise. Stock can be claimed between this response and
 *    the order being written; that race is closed at order creation, not here.
 */

const validateSchema = z.object({
  /** Which address to deliver to. Required only when signed in. */
  addressId: z.string().uuid('Address id must be a UUID').optional(),
  /** Coupon code to price. Never applied to the total without re-checking. */
  couponCode: z.string().trim().toUpperCase().max(64).optional(),
});

const FREE_SHIPPING_THRESHOLD = 2000;
const SHIPPING_FLAT_RATE = 99;

export const checkoutRouter: Router = Router();

checkoutRouter.post(
  '/checkout/validate',
  // Stricter than the general api limiter: 20 per 10 minutes. This endpoint
  // exists to be hammered just before an order, and the checkout limiter is
  // the one bucket meant for it (limiters.checkout).
  limiters.checkout,
  // Optional, not required: a guest must be able to see totals and a shipping
  // figure before being asked to sign in. `addressId` is then ignored — there
  // is nothing to attach it to — which is reported rather than silently
  // ignored, so the client can explain the step order to the shopper.
  optionalAuth(),
  validate({ body: validateSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const body = valid<z.infer<typeof validateSchema>>(req, 'body');
    const user = req.user;

    // ---- the basket ---------------------------------------------------
    const cart = user
      ? await db
          .selectFrom('carts')
          .select('id')
          .where('user_id', '=', user.id)
          .executeTakeFirst()
      : await guestCart(req);

    if (!cart) {
      res.json({
        data: {
          canCheckout: false,
          blockers: [{ code: 'EMPTY_CART', message: 'Your basket is empty' }],
          totals: null,
          lines: [],
          address: null,
          addressIgnoredForGuest: Boolean(body.addressId),
        },
      });
      return;
    }

    const lines = await db
      .selectFrom('cart_items')
      .innerJoin('products', 'products.id', 'cart_items.product_id')
      .leftJoin('inventory', 'inventory.product_id', 'products.id')
      .select([
        'cart_items.id as itemId',
        'cart_items.quantity as requestedQuantity',
        'products.id as productId',
        'products.name',
        'products.price',
        'products.is_active',
        'inventory.quantity as invQuantity',
        'inventory.reserved_quantity as invReserved',
      ])
      .where('cart_items.cart_id', '=', cart.id)
      .execute();

    // ---- blockers ------------------------------------------------------
    const blockers: { code: string; message: string; productId?: string }[] =
      [];

    const priced: {
      itemId: string;
      productId: string;
      name: string;
      quantity: number;
      unitPrice: number;
      lineTotal: number;
      available: number;
    }[] = [];

    for (const line of lines) {
      if (!line.is_active) {
        blockers.push({
          code: 'PRODUCT_UNAVAILABLE',
          message: `${line.name} is no longer available`,
          productId: line.productId,
        });
        continue;
      }

      const onHand = (line.invQuantity ?? 0) - (line.invReserved ?? 0);

      if (onHand <= 0) {
        blockers.push({
          code: 'OUT_OF_STOCK',
          message: `${line.name} is out of stock`,
          productId: line.productId,
        });
        continue;
      }

      if (line.requestedQuantity > onHand) {
        blockers.push({
          code: 'INSUFFICIENT_STOCK',
          message:
            onHand === 1
              ? `Only 1 of ${line.name} left`
              : `Only ${onHand} of ${line.name} left`,
          productId: line.productId,
        });
        continue;
      }

      priced.push({
        itemId: line.itemId,
        productId: line.productId,
        name: line.name,
        quantity: line.requestedQuantity,
        unitPrice: line.price,
        lineTotal: line.price * line.requestedQuantity,
        available: onHand,
      });
    }

    // ---- the address ---------------------------------------------------
    let address: Record<string, unknown> | null = null;
    if (user && body.addressId) {
      const row = await db
        .selectFrom('addresses')
        .select([
          'id',
          'full_name',
          'mobile',
          'house_number_and_street',
          'area',
          'city',
          'state',
          'pin_code',
          'country',
          'is_default',
        ])
        .where('id', '=', body.addressId)
        .where('user_id', '=', user.id)
        .executeTakeFirst();

      if (!row) {
        blockers.push({
          code: 'ADDRESS_NOT_FOUND',
          message: 'That delivery address could not be found',
        });
      } else {
        address = {
          id: row.id,
          fullName: row.full_name,
          mobile: row.mobile,
          houseNumberAndStreet: row.house_number_and_street,
          area: row.area,
          city: row.city,
          state: row.state,
          pinCode: row.pin_code,
          country: row.country,
          isDefault: row.is_default,
        };
      }
    } else if (!user && body.addressId) {
      // Named explicitly so the client knows why the step did not apply
      // rather than inferring a bug.
      blockers.push({
        code: 'AUTH_REQUIRED_FOR_ADDRESS',
        message: 'Sign in to save a delivery address',
      });
    }

    // ---- totals --------------------------------------------------------
    const subtotal = priced.reduce((n, l) => n + l.lineTotal, 0);
    const shipping =
      subtotal === 0 || subtotal >= FREE_SHIPPING_THRESHOLD
        ? 0
        : SHIPPING_FLAT_RATE;

    // ---- coupon --------------------------------------------------------
    // Priced here and now, from the coupons table. The same check runs again
    // at order creation; this copy exists so the shopper sees the discount on
    // the review screen rather than after paying.
    let discount = 0;
    let couponRejected: string | null = null;
    if (body.couponCode && subtotal > 0) {
      const coupon = await db
        .selectFrom('coupons')
        .select([
          'code',
          'discount_type',
          'discount_value',
          'min_order_amount',
          'max_discount',
          'usage_limit',
          'used_count',
          'starts_at',
          'expires_at',
          'is_active',
        ])
        .where('code', '=', body.couponCode)
        .executeTakeFirst();

      const now = Date.now();
      if (
        !coupon ||
        !coupon.is_active ||
        (coupon.starts_at && coupon.starts_at.getTime() > now) ||
        (coupon.expires_at && coupon.expires_at.getTime() < now) ||
        (coupon.usage_limit !== null &&
          coupon.used_count >= coupon.usage_limit) ||
        (coupon.min_order_amount !== null && subtotal < coupon.min_order_amount)
      ) {
        couponRejected = 'That coupon code cannot be used on this order';
      } else if (coupon.discount_type === 'percentage') {
        discount = Math.floor((subtotal * coupon.discount_value) / 100);
      } else {
        discount = coupon.discount_value;
      }

      if (
        coupon?.max_discount !== null &&
        coupon?.max_discount !== undefined &&
        discount > coupon.max_discount
      ) {
        discount = coupon.max_discount;
      }

      // Never let a discount exceed the order. A 100% coupon on a basket that
      // then charges shipping is not a discount, it is a payment error.
      discount = Math.min(discount, subtotal);
    }

    const total = Math.max(subtotal - discount + shipping, 0);

    // Stock and address are blockers; a rejected coupon is not — the order can
    // still go ahead without it.
    const canCheckout = blockers.length === 0 && priced.length > 0;

    res.json({
      data: {
        canCheckout,
        blockers,
        totals: {
          subtotal,
          shipping,
          discount,
          total,
          itemCount: priced.reduce((n, l) => n + l.quantity, 0),
          freeShippingThreshold: FREE_SHIPPING_THRESHOLD,
          amountToFreeShipping: Math.max(FREE_SHIPPING_THRESHOLD - subtotal, 0),
        },
        lines: priced,
        coupon: {
          applied: discount > 0,
          rejected: couponRejected,
        },
        address,
        addressIgnoredForGuest: false,
      },
    });
  }),
);

/** The guest cart named by the cookie, if there is one. */
async function guestCart(req: Request): Promise<{ id: string } | undefined> {
  const sessionId = req.cookies?.zyvora_cart;
  if (!sessionId) return undefined;
  return db
    .selectFrom('carts')
    .select('id')
    .where('session_id', '=', sessionId)
    .executeTakeFirst();
}

/**
 * Mounted separately from the rest of the checkout surface, which will require
 * authentication. Exported so the order-creation step in E9 can mount it in
 * the authenticated group instead.
 */
export { requireAuth as requireCheckoutAuth };
