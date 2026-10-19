import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';

import { db } from '../db/client.js';
import { asyncHandler } from '../http/async-handler.js';
import { AppError } from '../http/errors.js';
import { validate, valid } from '../http/validate.js';
import { requireAuth } from '../http/auth.js';
import { limiters } from '../http/rate-limit.js';
import { getMailer } from '../mail/mailer.js';

/**
 * Customer Orders & Lifecycle API
 *
 * Implements:
 * - ZYV-61: POST /api/orders (create pending order, reserve stock, clear cart)
 * - ZYV-77: GET /api/orders & GET /api/orders/:id (own orders only)
 * - ZYV-89: POST /api/orders/:id/cancel (cancel pending/processing orders, release stock)
 * - ZYV-87: POST /api/orders/:id/return (return/refund requests for delivered orders)
 */

export const orderRouter: Router = Router();

// Apply auth to all customer order routes
orderRouter.use(requireAuth());

const createOrderSchema = z.object({
  addressId: z.string().uuid('Address ID must be a UUID'),
  couponCode: z.string().trim().toUpperCase().max(64).optional(),
  checkoutSessionId: z
    .string()
    .uuid('Checkout session ID must be a UUID')
    .optional(),
});

const uuidParamSchema = z.object({
  id: z.string().uuid('Order ID must be a valid UUID'),
});

const cancelOrderSchema = z.object({
  reason: z.string().trim().min(3).max(500).optional(),
});

const returnOrderSchema = z.object({
  reason: z.string().trim().min(5, 'Please provide a return reason').max(1000),
});

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(10),
  status: z.string().trim().optional(),
});

const FREE_SHIPPING_THRESHOLD = 2000;
const SHIPPING_FLAT_RATE = 99;

/**
 * POST /api/orders — Create pending order after server validation (ZYV-61).
 */
orderRouter.post(
  '/orders',
  limiters.checkout,
  validate({ body: createOrderSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const user = req.user!;
    const { addressId, couponCode, checkoutSessionId } = valid<
      z.infer<typeof createOrderSchema>
    >(req, 'body');

    const sessionId = checkoutSessionId ?? randomUUID();

    // Idempotency check: if an order with this checkout session already exists for this user, return it
    const existingOrder = await db
      .selectFrom('orders')
      .selectAll()
      .where('user_id', '=', user.id)
      .where('checkout_session_id', '=', sessionId)
      .executeTakeFirst();

    if (existingOrder) {
      const items = await db
        .selectFrom('order_items')
        .selectAll()
        .where('order_id', '=', existingOrder.id)
        .execute();

      res.status(200).json({
        data: {
          order: existingOrder,
          items,
          isDuplicate: true,
        },
      });
      return;
    }

    // 1. Verify delivery address ownership
    const address = await db
      .selectFrom('addresses')
      .selectAll()
      .where('id', '=', addressId)
      .where('user_id', '=', user.id)
      .executeTakeFirst();

    if (!address) {
      throw new AppError(
        'NOT_FOUND',
        'Delivery address not found or does not belong to you',
      );
    }

    const addressSnapshot = {
      fullName: address.full_name,
      mobile: address.mobile,
      email: address.email,
      houseNumberAndStreet: address.house_number_and_street,
      area: address.area,
      landmark: address.landmark,
      city: address.city,
      state: address.state,
      pinCode: address.pin_code,
      country: address.country,
      deliveryInstructions: address.delivery_instructions,
    };

    // 2. Fetch customer cart and items
    const cart = await db
      .selectFrom('carts')
      .select('id')
      .where('user_id', '=', user.id)
      .executeTakeFirst();

    const cartItems = cart
      ? await db
          .selectFrom('cart_items')
          .innerJoin('products', 'products.id', 'cart_items.product_id')
          .leftJoin('inventory', 'inventory.product_id', 'products.id')
          .select([
            'cart_items.id as itemId',
            'cart_items.quantity',
            'products.id as productId',
            'products.name',
            'products.price',
            'products.is_active',
            'inventory.quantity as invQuantity',
            'inventory.reserved_quantity as invReserved',
          ])
          .where('cart_items.cart_id', '=', cart.id)
          .execute()
      : [];

    if (cartItems.length === 0) {
      throw new AppError('BAD_REQUEST', 'Your cart is empty');
    }

    // 3. Validate items availability and stock
    for (const item of cartItems) {
      if (!item.is_active) {
        throw new AppError(
          'BAD_REQUEST',
          `"${item.name}" is no longer available for purchase`,
        );
      }
      const available = (item.invQuantity ?? 0) - (item.invReserved ?? 0);
      if (item.quantity > available) {
        throw new AppError(
          'BAD_REQUEST',
          `Insufficient stock for "${item.name}". Only ${available} available.`,
        );
      }
    }

    // 4. Calculate server-authoritative totals
    const subtotal = cartItems.reduce(
      (sum, item) => sum + item.price * item.quantity,
      0,
    );
    const shipping =
      subtotal >= FREE_SHIPPING_THRESHOLD ? 0 : SHIPPING_FLAT_RATE;
    const tax = 0;
    let discount = 0;
    let appliedCoupon: any = null;

    if (couponCode) {
      const coupon = await db
        .selectFrom('coupons')
        .selectAll()
        .where('code', '=', couponCode)
        .where('is_active', '=', true)
        .executeTakeFirst();

      if (coupon) {
        const now = new Date();
        const notExpired = !coupon.expires_at || coupon.expires_at > now;
        const limitNotReached =
          coupon.usage_limit === null || coupon.used_count < coupon.usage_limit;
        const minOrderMet =
          !coupon.min_order_amount || subtotal >= coupon.min_order_amount;

        if (notExpired && limitNotReached && minOrderMet) {
          appliedCoupon = coupon;
          if (coupon.discount_type === 'percentage') {
            const rawDiscount = Math.round(
              (subtotal * coupon.discount_value) / 100,
            );
            discount = coupon.max_discount
              ? Math.min(rawDiscount, coupon.max_discount)
              : rawDiscount;
          } else {
            discount = coupon.discount_value;
          }
          discount = Math.min(discount, subtotal);
        }
      }
    }

    const total = subtotal - discount + shipping;
    const orderId = randomUUID();

    // 5. Execute transaction atomically
    const createdOrder = await db.transaction().execute(async (trx) => {
      // A. Reserve stock for each item
      for (const item of cartItems) {
        const updateRes = await trx
          .updateTable('inventory')
          .set((eb) => ({
            reserved_quantity: eb('reserved_quantity', '+', item.quantity),
          }))
          .where('product_id', '=', item.productId)
          .where(sql<boolean>`quantity - reserved_quantity >= ${item.quantity}`)
          .executeTakeFirst();

        if (Number(updateRes.numUpdatedRows) === 0) {
          throw new AppError(
            'BAD_REQUEST',
            `Could not reserve stock for "${item.name}". Please try again.`,
          );
        }
      }

      // B. Increment coupon used count if applied
      if (appliedCoupon) {
        await trx
          .updateTable('coupons')
          .set((eb) => ({
            used_count: eb('used_count', '+', 1),
          }))
          .where('id', '=', appliedCoupon.id)
          .execute();
      }

      // C. Insert order
      const [order] = await trx
        .insertInto('orders')
        .values({
          id: orderId,
          user_id: user.id,
          checkout_session_id: sessionId,
          shipping_address_id: addressId,
          shipping_address_snapshot: JSON.stringify(addressSnapshot),
          subtotal,
          shipping,
          tax,
          discount,
          total,
          status: 'pending',
        })
        .returningAll()
        .execute();

      // D. Insert order items
      const itemInserts = cartItems.map((item) => ({
        id: randomUUID(),
        order_id: orderId,
        product_id: item.productId,
        name: item.name,
        unit_price: item.price,
        quantity: item.quantity,
      }));

      const items = await trx
        .insertInto('order_items')
        .values(itemInserts)
        .returningAll()
        .execute();

      // E. Create pending payment record
      await trx
        .insertInto('payments')
        .values({
          id: randomUUID(),
          order_id: orderId,
          amount: total,
          currency: 'INR',
          status: 'pending',
          method: 'deferred',
        })
        .execute();

      // F. Clear customer cart
      if (cart) {
        await trx
          .deleteFrom('cart_items')
          .where('cart_id', '=', cart.id)
          .execute();
      }

      return { order, items };
    });

    // 6. Send order confirmation email asynchronously
    try {
      const mailer = getMailer();
      await mailer.sendOrderConfirmation({
        to: user.email,
        orderId: createdOrder.order.id,
        customerName: address.full_name,
        items: createdOrder.items.map((it) => ({
          name: it.name,
          quantity: it.quantity,
          unitPrice: it.unit_price,
          lineTotal: it.unit_price * it.quantity,
        })),
        shippingAddress: {
          fullName: address.full_name,
          houseNumberAndStreet: address.house_number_and_street,
          area: address.area,
          city: address.city,
          state: address.state,
          pinCode: address.pin_code,
        },
        totals: {
          subtotal,
          shipping,
          tax,
          discount,
          total,
        },
      });
    } catch {
      // Non-blocking: order creation succeeds even if email transport fails
    }

    res.status(201).json({
      data: {
        order: {
          ...createdOrder.order,
          shippingAddress: addressSnapshot,
        },
        items: createdOrder.items,
      },
    });
  }),
);

/**
 * GET /api/orders — List own orders (ZYV-77).
 */
orderRouter.get(
  '/orders',
  validate({ query: listQuerySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const user = req.user!;
    const { page, limit, status } = valid<z.infer<typeof listQuerySchema>>(
      req,
      'query',
    );
    const offset = (page - 1) * limit;

    let baseQuery = db.selectFrom('orders').where('user_id', '=', user.id);

    if (status) {
      baseQuery = baseQuery.where('status', '=', status);
    }

    const countRes = await baseQuery
      .select((eb) => eb.fn.count('id').as('count'))
      .executeTakeFirst();
    const total = Number(countRes?.count ?? 0);

    const orders = await baseQuery
      .selectAll()
      .orderBy('created_at', 'desc')
      .limit(limit)
      .offset(offset)
      .execute();

    // Fetch items and shipments for these orders
    const orderIds = orders.map((o) => o.id);
    let items: any[] = [];
    let shipments: any[] = [];

    if (orderIds.length > 0) {
      items = await db
        .selectFrom('order_items')
        .selectAll()
        .where('order_id', 'in', orderIds)
        .execute();

      shipments = await db
        .selectFrom('shipments')
        .selectAll()
        .where('order_id', 'in', orderIds)
        .execute();
    }

    const enrichedOrders = orders.map((ord) => {
      const orderItems = items.filter((it) => it.order_id === ord.id);
      const shipment = shipments.find((s) => s.order_id === ord.id);
      let addressSnapshot = null;
      if (ord.shipping_address_snapshot) {
        try {
          addressSnapshot =
            typeof ord.shipping_address_snapshot === 'string'
              ? JSON.parse(ord.shipping_address_snapshot)
              : ord.shipping_address_snapshot;
        } catch {
          addressSnapshot = null;
        }
      }

      return {
        ...ord,
        items: orderItems,
        shipment: shipment ?? null,
        shippingAddress: addressSnapshot,
      };
    });

    res.json({
      data: enrichedOrders,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  }),
);

/**
 * GET /api/orders/:id — Get own order detail (ZYV-77).
 */
orderRouter.get(
  '/orders/:id',
  validate({ params: uuidParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const user = req.user!;
    const { id } = valid<{ id: string }>(req, 'params');

    const order = await db
      .selectFrom('orders')
      .selectAll()
      .where('id', '=', id)
      .where('user_id', '=', user.id)
      .executeTakeFirst();

    if (!order) {
      throw new AppError('NOT_FOUND', 'Order not found');
    }

    const items = await db
      .selectFrom('order_items')
      .selectAll()
      .where('order_id', '=', id)
      .execute();

    const payment = await db
      .selectFrom('payments')
      .selectAll()
      .where('order_id', '=', id)
      .executeTakeFirst();

    const shipment = await db
      .selectFrom('shipments')
      .selectAll()
      .where('order_id', '=', id)
      .executeTakeFirst();

    let addressSnapshot = null;
    if (order.shipping_address_snapshot) {
      try {
        addressSnapshot =
          typeof order.shipping_address_snapshot === 'string'
            ? JSON.parse(order.shipping_address_snapshot)
            : order.shipping_address_snapshot;
      } catch {
        addressSnapshot = null;
      }
    }

    res.json({
      data: {
        ...order,
        items,
        payment: payment ?? null,
        shipment: shipment ?? null,
        shippingAddress: addressSnapshot,
      },
    });
  }),
);

/**
 * POST /api/orders/:id/cancel — Cancel order per cancellation policy (ZYV-89).
 */
orderRouter.post(
  '/orders/:id/cancel',
  validate({ params: uuidParamSchema, body: cancelOrderSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const user = req.user!;
    const { id } = valid<{ id: string }>(req, 'params');
    const { reason } = valid<z.infer<typeof cancelOrderSchema>>(req, 'body');

    const order = await db
      .selectFrom('orders')
      .selectAll()
      .where('id', '=', id)
      .where('user_id', '=', user.id)
      .executeTakeFirst();

    if (!order) {
      throw new AppError('NOT_FOUND', 'Order not found');
    }

    // Cancellation policy: orders can only be cancelled while in pending, confirmed, or processing
    const CANCELLABLE_STATUSES = ['pending', 'confirmed', 'processing'];
    if (!CANCELLABLE_STATUSES.includes(order.status.toLowerCase())) {
      throw new AppError(
        'BAD_REQUEST',
        `Order in "${order.status}" status cannot be cancelled per the cancellation policy.`,
      );
    }

    const items = await db
      .selectFrom('order_items')
      .selectAll()
      .where('order_id', '=', id)
      .execute();

    const updatedOrder = await db.transaction().execute(async (trx) => {
      // Release reserved inventory
      for (const item of items) {
        await trx
          .updateTable('inventory')
          .set((eb) => ({
            reserved_quantity: eb('reserved_quantity', '-', item.quantity),
          }))
          .where('product_id', '=', item.product_id)
          .where('reserved_quantity', '>=', item.quantity)
          .execute();
      }

      // Update order status
      const [updated] = await trx
        .updateTable('orders')
        .set({
          status: 'cancelled',
          cancel_reason: reason ?? 'Cancelled by customer',
          cancelled_at: new Date(),
          updated_at: new Date(),
        })
        .where('id', '=', id)
        .returningAll()
        .execute();

      return updated;
    });

    res.json({
      data: {
        order: updatedOrder,
        message: 'Order cancelled successfully and stock reservation released',
      },
    });
  }),
);

/**
 * POST /api/orders/:id/return — Request return/refund per return policy (ZYV-87).
 */
orderRouter.post(
  '/orders/:id/return',
  validate({ params: uuidParamSchema, body: returnOrderSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const user = req.user!;
    const { id } = valid<{ id: string }>(req, 'params');
    const { reason } = valid<z.infer<typeof returnOrderSchema>>(req, 'body');

    const order = await db
      .selectFrom('orders')
      .selectAll()
      .where('id', '=', id)
      .where('user_id', '=', user.id)
      .executeTakeFirst();

    if (!order) {
      throw new AppError('NOT_FOUND', 'Order not found');
    }

    // Return policy: returns can only be requested for delivered orders
    if (order.status.toLowerCase() !== 'delivered') {
      throw new AppError(
        'BAD_REQUEST',
        'Returns can only be requested for orders that have been delivered.',
      );
    }

    const payment = await db
      .selectFrom('payments')
      .selectAll()
      .where('order_id', '=', id)
      .executeTakeFirst();

    const updatedOrder = await db.transaction().execute(async (trx) => {
      const [updated] = await trx
        .updateTable('orders')
        .set({
          status: 'return_requested',
          return_reason: reason,
          return_requested_at: new Date(),
          updated_at: new Date(),
        })
        .where('id', '=', id)
        .returningAll()
        .execute();

      if (payment) {
        await trx
          .insertInto('refunds')
          .values({
            id: randomUUID(),
            payment_id: payment.id,
            amount: order.total,
            reason,
            status: 'pending',
          })
          .execute();
      }

      return updated;
    });

    res.json({
      data: {
        order: updatedOrder,
        message: 'Return request submitted successfully and is pending review',
      },
    });
  }),
);
