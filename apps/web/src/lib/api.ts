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

const BASE_URL = (
  import.meta.env.VITE_API_URL ?? 'http://localhost:4000'
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
