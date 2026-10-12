import type {
  ApiError,
  Product,
  ProductCategory,
  ProductSummary,
} from '@zyvora/types';

/**
 * Thin typed client for the ZYVORA catalog API.
 *
 * Base URL comes from VITE_API_URL. Every response is the API's
 * `{ data, meta }` envelope; a failure is the ApiError envelope from
 * @zyvora/types, so callers get one discriminated shape to handle.
 */

const BASE_URL = (
  import.meta.env.VITE_API_URL ?? 'http://localhost:4000'
).replace(/\/$/, '');

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

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = code;
  }
}

async function request<T>(path: string, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      signal,
      headers: { Accept: 'application/json' },
    });
  } catch {
    // Network-level failure (API down, CORS, DNS) — distinct from a 4xx/5xx.
    throw new ApiRequestError(
      0,
      'NETWORK_ERROR',
      `Could not reach the API at ${BASE_URL}. Is the server running?`,
    );
  }

  if (!response.ok) {
    let code = 'INTERNAL_ERROR';
    let message = `Request failed with status ${response.status}`;
    try {
      const body = (await response.json()) as ApiError;
      if (body?.error?.code) code = body.error.code;
      if (body?.error?.message) message = body.error.message;
    } catch {
      // Non-JSON error body; keep the generic message.
    }
    throw new ApiRequestError(response.status, code, message);
  }

  return (await response.json()) as T;
}

export function fetchCategories(signal?: AbortSignal): Promise<Category[]> {
  return request<{ data: Category[] }>('/api/categories', signal).then(
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
    signal,
  );
}

export function fetchProductById(
  id: string,
  signal?: AbortSignal,
): Promise<Product & { inStock: boolean; quantityAvailable: number }> {
  return request<{
    data: Product & { inStock: boolean; quantityAvailable: number };
  }>(`/api/products/${encodeURIComponent(id)}`, signal).then((r) => r.data);
}

export function searchProducts(
  q: string,
  signal?: AbortSignal,
): Promise<{ data: ProductSummary[]; meta: { query: string } }> {
  return request<{ data: ProductSummary[]; meta: { query: string } }>(
    `/api/products/search?q=${encodeURIComponent(q)}`,
    signal,
  );
}
