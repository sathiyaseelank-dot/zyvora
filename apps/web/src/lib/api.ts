import type {
  ApiError,
  Product,
  ProductCategory,
  ProductSummary,
} from '@zyvora/types';

/**
 * Typed client for the ZYVORA API.
 *
 * Two things here are load-bearing and easy to get wrong:
 *
 *  - `credentials: 'include'`. The session cookie is HttpOnly, so the browser
 *    is the only thing that can carry it, and in development the app and the
 *    API are different origins (5173 vs 4000). Without this the cookie is
 *    silently dropped and every authenticated screen reads as signed out.
 *    The API sets `Access-Control-Allow-Credentials`, so this is permitted.
 *
 *  - The CSRF header. The API guards every state-changing request with a
 *    double-submit token: a readable `zyvora_csrf` cookie and a matching
 *    `x-csrf-token` header. A cross-site page can cause the browser to send
 *    the cookie but cannot read it, so it cannot produce the header. Every
 *    mutation therefore has to fetch the token first.
 */

/**
 * Where the API lives, from the page's point of view.
 *
 * Set VITE_API_URL to an absolute URL to call the API cross-origin. Set it
 * EMPTY (or leave it unset in production) to call the same origin through a
 * proxy, which is what production does — see vercel.json.
 *
 * Why that matters, because it is not obvious and it cost a deployment:
 * `vercel.app` and `onrender.com` are different registrable domains, so a
 * cross-origin call is CROSS-SITE. The browser then refuses to send the
 * SameSite=Lax session and CSRF cookies, every state-changing request 403s,
 * and login can never work. Verified against the deployed service:
 *
 *   cookie + header  -> passes the CSRF guard (500 later, from the database)
 *   header only      -> 403
 *
 * Same-origin removes the problem at the root: the cookies are first-party,
 * SameSite=Lax behaves, and CORS stops being involved at all.
 */
const configured = (import.meta.env.VITE_API_URL ?? '').trim();

const BASE_URL = (
  configured ||
  (import.meta.env.DEV ? 'http://localhost:4000' : window.location.origin)
).replace(/\/$/, '');

export const CSRF_HEADER = 'x-csrf-token';

export interface Category {
  name: string;
  slug: string;
  description: string | null;
}

export interface ListMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  sort: string;
  category?: ProductCategory;
}

export type ProductSort = 'price_asc' | 'price_desc' | 'name_asc' | 'name_desc';

/**
 * Per-field validation messages, keyed by field name.
 *
 * The API returns Zod's `flatten()` shape for validation failures, which is
 * what lets a form highlight the offending input instead of printing one
 * opaque sentence above the form.
 */
export type FieldErrors = Record<string, string[]>;

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fieldErrors: FieldErrors;

  constructor(
    status: number,
    code: string,
    message: string,
    fieldErrors: FieldErrors = {},
  ) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = code;
    this.fieldErrors = fieldErrors;
  }

  /** First message for one field, if the API named it. */
  forField(name: string): string | undefined {
    return this.fieldErrors[name]?.[0];
  }
}

export class NetworkError extends ApiRequestError {
  constructor(baseUrl: string) {
    super(
      0,
      'NETWORK_ERROR',
      `Could not reach the API at ${baseUrl}. Is the server running?`,
    );
    this.name = 'NetworkError';
  }
}

export class CsrfError extends ApiRequestError {
  constructor() {
    super(
      403,
      'CSRF_ERROR',
      'Your session security token expired. Please try again.',
    );
    this.name = 'CsrfError';
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
}

const SAFE_METHODS = new Set(['GET', 'HEAD']);

/**
 * Cached CSRF token.
 *
 * Fetched on first mutation and reused afterwards, because it is a per-session
 * value rather than a per-request nonce. Cleared and refetched if the server
 * ever rejects it, so a token rotated by login/logout cannot wedge the UI.
 */
let csrfToken: string | null = null;
let csrfInFlight: Promise<string> | null = null;

async function fetchCsrfToken(): Promise<string> {
  const response = await fetch(`${BASE_URL}/api/auth/csrf`, {
    credentials: 'include',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new CsrfError();
  }
  const body = (await response.json()) as { data: { csrfToken: string } };
  return body.data.csrfToken;
}

/**
 * Current token, fetching one if needed.
 *
 * Concurrent callers share a single in-flight request. Without this, a page
 * that mounts two forms fires two `/api/auth/csrf` calls, and the loser
 * overwrites the winner's cached value — harmless today, but it means the
 * cache and the cookie can disagree about which token is current.
 */
export async function ensureCsrfToken(): Promise<string> {
  if (csrfToken) return csrfToken;
  csrfInFlight ??= fetchCsrfToken()
    .then((token) => {
      csrfToken = token;
      return token;
    })
    .finally(() => {
      // Cleared either way: a failure must not leave a rejected promise
      // cached, or every later call re-rejects.
      csrfInFlight = null;
    });
  return csrfInFlight;
}

/** Drop the cached token. Called after login/logout, which rotate it. */
export function resetCsrfToken(): void {
  csrfToken = null;
  csrfInFlight = null;
}

export async function request<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const { method = 'GET', body, signal } = options;

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (!SAFE_METHODS.has(method)) {
    headers[CSRF_HEADER] = await ensureCsrfToken();
  }

  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method,
      signal,
      credentials: 'include',
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new NetworkError(BASE_URL);
  }

  if (response.status === 403 && !SAFE_METHODS.has(method)) {
    // The token was rotated or the cookie was cleared. Drop it, take a fresh
    // one, and replay once. Replaying twice is not attempted: if a second 403
    // arrives the request is genuinely forbidden and the caller should see it.
    resetCsrfToken();
    if (!path.includes('/api/auth/csrf')) {
      return request<T>(path, options);
    }
  }

  if (!response.ok) {
    let code = 'INTERNAL_ERROR';
    let message = `Request failed with status ${response.status}`;
    let fieldErrors: FieldErrors = {};
    try {
      const parsed = (await response.json()) as ApiError & {
        error?: { details?: { fieldErrors?: FieldErrors } };
      };
      if (parsed?.error?.code) code = parsed.error.code;
      if (parsed?.error?.message) message = parsed.error.message;
      if (parsed?.error?.details?.fieldErrors) {
        /*
         * The API keys these by request part: `body.email`, not `email`.
         * Verified against the running service —
         *
         *   "fieldErrors": { "body.email": ["Invalid email"], ... }
         *
         * Passing those keys straight through leaves a form looking up
         * `error.fieldErrors.email`, which is always undefined — so every
         * validation message renders in the banner and none reach the input
         * they describe. Normalised here so callers only ever see the field
         * name. `body`, `query` and `params` are the prefixes Zod produces.
         */
        fieldErrors = {};
        for (const [key, messages] of Object.entries(
          parsed.error.details.fieldErrors,
        )) {
          const field = key.replace(/^(body|query|params)\./, '');
          fieldErrors[field] = messages;
        }
      }
    } catch {
      // Non-JSON error body; keep the generic message.
    }
    throw new ApiRequestError(response.status, code, message, fieldErrors);
  }

  if (response.status === 204) return undefined as T;

  return (await response.json()) as T;
}

/* ---------------------------------------------------------------- catalog -- */

export function fetchCategories(signal?: AbortSignal): Promise<Category[]> {
  return request<{ data: Category[] }>('/api/categories', { signal }).then(
    (r) => r.data,
  );
}

export function fetchProducts(
  params: {
    category?: ProductCategory;
    sort?: ProductSort;
    page?: number;
    pageSize?: number;
  },
  signal?: AbortSignal,
): Promise<{ data: ProductSummary[]; meta: ListMeta }> {
  const query = new URLSearchParams();
  if (params.category) query.set('category', params.category);
  if (params.sort) query.set('sort', params.sort);
  if (params.page) query.set('page', String(params.page));
  if (params.pageSize) query.set('pageSize', String(params.pageSize));
  const qs = query.toString();
  return request<{ data: ProductSummary[]; meta: ListMeta }>(
    `/api/products${qs ? `?${qs}` : ''}`,
    { signal },
  );
}

export function fetchProductById(
  id: string,
  signal?: AbortSignal,
): Promise<Product & { inStock: boolean; quantityAvailable: number }> {
  return request<{
    data: Product & { inStock: boolean; quantityAvailable: number };
  }>(`/api/products/${encodeURIComponent(id)}`, { signal }).then((r) => r.data);
}

export function searchProducts(
  q: string,
  signal?: AbortSignal,
): Promise<{ data: ProductSummary[]; meta: { query: string } }> {
  return request<{ data: ProductSummary[]; meta: { query: string } }>(
    `/api/products/search?q=${encodeURIComponent(q)}`,
    { signal },
  );
}

/* ------------------------------------------------------------------- cart -- */

/**
 * Cart types, mirroring apps/api/src/routes/cart.ts.
 *
 * Totals arrive computed from the server on every response. Nothing here is
 * derived in the browser: a client-side subtotal would be a second source of
 * truth competing with the one that actually settles the order.
 */
export interface CartLine {
  itemId: string;
  productId: string;
  name: string;
  image: string;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
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

export interface Cart {
  lines: CartLine[];
  totals: CartTotals;
}

export function fetchCart(signal?: AbortSignal): Promise<Cart> {
  return request<{ data: Cart }>('/api/cart', { signal }).then((r) => r.data);
}

export function addCartItem(
  productId: string,
  quantity = 1,
  signal?: AbortSignal,
): Promise<Cart> {
  return request<{ data: Cart }>('/api/cart/items', {
    method: 'POST',
    body: { productId, quantity },
    signal,
  }).then((r) => r.data);
}

export function updateCartItem(
  itemId: string,
  quantity: number,
  signal?: AbortSignal,
): Promise<Cart> {
  return request<{ data: Cart }>(
    `/api/cart/items/${encodeURIComponent(itemId)}`,
    {
      method: 'PATCH',
      body: { quantity },
      signal,
    },
  ).then((r) => r.data);
}

export function removeCartItem(
  itemId: string,
  signal?: AbortSignal,
): Promise<Cart> {
  return request<{ data: Cart }>(
    `/api/cart/items/${encodeURIComponent(itemId)}`,
    {
      method: 'DELETE',
      signal,
    },
  ).then((r) => r.data);
}

/* ---------------------------------------------------------------- addresses - */

export interface Address {
  id: string;
  fullName: string;
  mobile: string;
  email: string;
  houseNumberAndStreet: string;
  area: string;
  landmark?: string | null;
  city: string;
  state: string;
  pinCode: string;
  country: string;
  deliveryInstructions?: string | null;
  isDefault: boolean;
}

export type AddressInput = Omit<Address, 'id'>;

export function fetchAddresses(signal?: AbortSignal): Promise<Address[]> {
  return request<{ data: Address[] }>('/api/addresses', { signal }).then(
    (r) => r.data,
  );
}

export function createAddress(
  body: AddressInput,
  signal?: AbortSignal,
): Promise<Address> {
  return request<{ data: Address }>('/api/addresses', {
    method: 'POST',
    body,
    signal,
  }).then((r) => r.data);
}

export function updateAddress(
  id: string,
  body: Partial<AddressInput>,
  signal?: AbortSignal,
): Promise<Address> {
  return request<{ data: Address }>(
    `/api/addresses/${encodeURIComponent(id)}`,
    {
      method: 'PATCH',
      body,
      signal,
    },
  ).then((r) => r.data);
}

export function deleteAddress(
  id: string,
  signal?: AbortSignal,
): Promise<{ deleted: boolean }> {
  return request<{ data: { deleted: boolean } }>(
    `/api/addresses/${encodeURIComponent(id)}`,
    {
      method: 'DELETE',
      signal,
    },
  ).then((r) => r.data);
}

/* ----------------------------------------------------------------- checkout - */

export interface CheckoutValidation {
  canCheckout: boolean;
  blockers: Array<{ code: string; message: string }>;
  totals: {
    subtotal: number;
    shipping: number;
    discount: number;
    total: number;
  } | null;
  lines: Array<{
    itemId: string;
    productId: string;
    name: string;
    price: number;
    requestedQuantity: number;
  }>;
  address: Address | null;
  addressIgnoredForGuest?: boolean;
}

export function validateCheckout(
  body: { addressId?: string; couponCode?: string },
  signal?: AbortSignal,
): Promise<CheckoutValidation> {
  return request<{ data: CheckoutValidation }>('/api/checkout/validate', {
    method: 'POST',
    body,
    signal,
  }).then((r) => r.data);
}

/* ------------------------------------------------------------------- orders - */

export interface OrderItem {
  id: string;
  order_id: string;
  product_id: string;
  name: string;
  unit_price: number;
  quantity: number;
}

export interface Shipment {
  id: string;
  order_id: string;
  carrier: string | null;
  tracking_number: string | null;
  status: string;
  shipped_at: string | null;
  delivered_at: string | null;
}

export interface PaymentRecord {
  id: string;
  order_id: string;
  amount: number;
  currency: string;
  status: string;
  method: string | null;
}

export interface Order {
  id: string;
  user_id: string;
  checkout_session_id: string;
  status: string;
  subtotal: number;
  shipping: number;
  tax: number;
  discount: number;
  total: number;
  cancel_reason?: string | null;
  cancelled_at?: string | null;
  return_reason?: string | null;
  return_requested_at?: string | null;
  created_at: string;
  updated_at: string;
  items?: OrderItem[];
  shippingAddress?: Address | null;
  shipment?: Shipment | null;
  payment?: PaymentRecord | null;
}

export function createOrder(
  body: {
    addressId: string;
    couponCode?: string;
    checkoutSessionId?: string;
  },
  signal?: AbortSignal,
): Promise<{ order: Order; items: OrderItem[] }> {
  return request<{ data: { order: Order; items: OrderItem[] } }>(
    '/api/orders',
    {
      method: 'POST',
      body,
      signal,
    },
  ).then((r) => r.data);
}

export function fetchOrders(
  params?: { page?: number; limit?: number; status?: string },
  signal?: AbortSignal,
): Promise<{ data: Order[]; meta: ListMeta }> {
  const query = new URLSearchParams();
  if (params?.page) query.set('page', String(params.page));
  if (params?.limit) query.set('limit', String(params.limit));
  if (params?.status) query.set('status', params.status);

  return request<{ data: Order[]; meta: ListMeta }>(
    `/api/orders${query.toString() ? `?${query.toString()}` : ''}`,
    { signal },
  );
}

export function fetchOrder(id: string, signal?: AbortSignal): Promise<Order> {
  return request<{ data: Order }>(`/api/orders/${encodeURIComponent(id)}`, {
    signal,
  }).then((r) => r.data);
}

export function cancelOrder(
  id: string,
  reason?: string,
  signal?: AbortSignal,
): Promise<{ order: Order; message: string }> {
  return request<{ data: { order: Order; message: string } }>(
    `/api/orders/${encodeURIComponent(id)}/cancel`,
    {
      method: 'POST',
      body: { reason },
      signal,
    },
  ).then((r) => r.data);
}

export function requestReturn(
  id: string,
  reason: string,
  signal?: AbortSignal,
): Promise<{ order: Order; message: string }> {
  return request<{ data: { order: Order; message: string } }>(
    `/api/orders/${encodeURIComponent(id)}/return`,
    {
      method: 'POST',
      body: { reason },
      signal,
    },
  ).then((r) => r.data);
}

/* ------------------------------------------------------------------ account - */

export function updateProfile(
  body: { fullName?: string; mobile?: string },
  signal?: AbortSignal,
): Promise<{ id: string; email: string; fullName: string; mobile: string }> {
  return request<{
    data: { id: string; email: string; fullName: string; mobile: string };
  }>('/api/auth/profile', {
    method: 'PATCH',
    body,
    signal,
  }).then((r) => r.data);
}

export function changePassword(
  body: { currentPassword: string; newPassword: string },
  signal?: AbortSignal,
): Promise<{ message: string }> {
  return request<{ data: { message: string } }>('/api/auth/change-password', {
    method: 'POST',
    body,
    signal,
  }).then((r) => r.data);
}

/* ----------------------------------------------------------- content blocks - */

export function fetchContentBlock(
  slug: string,
  signal?: AbortSignal,
): Promise<{ id: string; slug: string; title: string; body: string }> {
  return request<{
    data: { id: string; slug: string; title: string; body: string };
  }>(`/api/content-blocks/${encodeURIComponent(slug)}`, { signal }).then(
    (r) => r.data,
  );
}
