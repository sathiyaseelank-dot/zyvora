/**
 * Types shared by the web app and the API.
 *
 * Keeping these in one place is what stops the frontend and backend from
 * drifting on shapes that cross the network. Every exported type here has a
 * corresponding Zod schema on the API side, and the API validates at runtime —
 * TypeScript alone cannot protect a network boundary.
 *
 * Story: ZYV-20 (Create shared types and configuration package)
 * Design: Architect's canonical contract for E1 — rupees, numeric IDs, single image, closed category union.
 */

/** Standard error envelope. Matches the API's typed error responses (ZYV-39). */
export interface ApiError {
  error: {
    code: ApiErrorCode;
    message: string;
    details?: unknown;
  };
}

export type ApiErrorCode =
  | 'NOT_FOUND'
  | 'INTERNAL_ERROR'
  | 'VALIDATION_ERROR'
  | 'AUTH_REQUIRED'
  | 'AUTH_INVALID'
  | 'FORBIDDEN'
  | 'CONFLICT'
  | 'RATE_LIMITED';

/**
 * Returned by any order-creating or payment-initiating endpoint when the
 * caller has no authenticated session (ADR-001 Q1).
 *
 * `handoffToken` names a checkout session. It deliberately carries no
 * destination of its own — the destination is resolved server-side on
 * redemption, so it cannot be forged or pointed at an external host.
 */
export interface AuthRequiredResponse extends Omit<ApiError, 'error'> {
  error: { code: 'AUTH_REQUIRED'; message: string; details?: unknown };
  checkoutSessionId: string;
  handoffToken: string;
}

/** Money is carried in INR rupees (integer) to avoid float drift. */
export type Price = number;

export type ProductCategory =
  'car-flags' | 'bike-flags' | 'accessories' | 'gift-sets';

/**
 * Identifier type. The E1 canonical contract drafted numeric IDs, but
 * migration 001/002 create every primary key as `uuid` with
 * `uuid_generate_v4()` defaults. The database is the runtime truth, so IDs are
 * strings here. Numeric IDs would require reworking the applied migrations.
 * OPEN QUESTION for the Architect — do not treat "string" as settled.
 */
export type ProductId = string;

export interface ProductSummary {
  id: ProductId;
  name: string;
  price: Price;
  category: ProductCategory;
  image: string;
}

export interface Product extends ProductSummary {
  description: string;
}

/**
 * A checkout session owns the cart snapshot, delivery address and step
 * position. It is the single source of truth for an in-progress checkout and
 * is what makes the auth round-trip lossless (ADR-001 Q3).
 */
export interface CheckoutSession {
  id: string;
  step: 'address' | 'review' | 'payment';
  items: { productId: ProductId; quantity: number }[];
  address: DeliveryAddress | null;
  /** Idempotency key for order creation — one session yields at most one order. */
  idempotencyKey: string;
  updatedAt: string;
}

export interface DeliveryAddress {
  fullName: string;
  mobile: string;
  email: string;
  houseNumberAndStreet: string;
  area: string;
  landmark?: string;
  city: string;
  state: string;
  pinCode: string;
  country: string;
  deliveryInstructions?: string;
}

export interface Order {
  id: string;
  checkoutSessionId: string;
  items: {
    productId: ProductId;
    name: string;
    unitPrice: Price;
    quantity: number;
  }[];
  address: DeliveryAddress;
  subtotal: Price;
  shipping: Price;
  tax: Price;
  discount: Price;
  total: Price;
  status:
    | 'created'
    | 'payment_pending'
    | 'paid'
    | 'shipped'
    | 'delivered'
    | 'cancelled';
  createdAt: string;
}
