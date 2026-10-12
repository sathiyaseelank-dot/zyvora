import { useEffect, useMemo, useState } from 'react';

import {
  ApiRequestError,
  fetchCategories,
  fetchProducts,
  type Category,
  type ProductSort,
} from './lib/api.ts';
import type { ProductCategory, ProductSummary } from '@zyvora/types';

/**
 * ZYVORA storefront (Option A — React + Vite, separate Express API).
 *
 * Reads the catalogue from the API rather than a local fixture, so this page
 * is genuinely end-to-end: if the API or database is down it says so instead
 * of rendering stale data.
 */

/** Integer rupees formatted at the edge only — never stored as a float. */
function formatPrice(rupees: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(rupees);
}

type LoadState<T> =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: T };

function ProductCard({ product }: { product: ProductSummary }) {
  return (
    <article className="group flex flex-col overflow-hidden rounded-lg border border-border bg-surface-elevated transition-shadow hover:shadow-brand">
      <div className="aspect-4/3 w-full overflow-hidden bg-brand-cream">
        <img
          src={product.image}
          alt={product.name}
          loading="lazy"
          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
        />
      </div>
      <div className="flex flex-1 flex-col gap-2 p-4">
        <p className="text-xs tracking-wide text-text-muted uppercase">
          {product.category.replace('-', ' ')}
        </p>
        <h3 className="text-base leading-snug font-medium text-text-primary">
          {product.name}
        </h3>
        <p className="mt-auto text-lg font-semibold text-brand-gold">
          {formatPrice(product.price)}
        </p>
      </div>
    </article>
  );
}

export default function App() {
  const [categories, setCategories] = useState<LoadState<Category[]>>({
    status: 'loading',
  });
  const [products, setProducts] = useState<LoadState<ProductSummary[]>>({
    status: 'loading',
  });
  const [category, setCategory] = useState<ProductCategory | undefined>();
  const [sort, setSort] = useState<ProductSort>('name_asc');
  const [total, setTotal] = useState(0);

  // Categories load once; they do not depend on the filter controls.
  useEffect(() => {
    const controller = new AbortController();
    fetchCategories(controller.signal)
      .then((data) => setCategories({ status: 'ready', data }))
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setCategories({
          status: 'error',
          message:
            err instanceof ApiRequestError
              ? err.message
              : 'Failed to load categories',
        });
      });
    return () => controller.abort();
  }, []);

  // Products refetch whenever the filter or sort changes.
  useEffect(() => {
    const controller = new AbortController();
    setProducts({ status: 'loading' });
    fetchProducts({ category, sort, pageSize: 24 }, controller.signal)
      .then((result) => {
        setProducts({ status: 'ready', data: result.data });
        setTotal(result.meta.total);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setProducts({
          status: 'error',
          message:
            err instanceof ApiRequestError
              ? err.message
              : 'Failed to load products',
        });
      });
    return () => controller.abort();
  }, [category, sort]);

  const visibleCategories = useMemo(() => {
    if (categories.status !== 'ready') return [];
    return categories.data;
  }, [categories]);

  return (
    <div className="min-h-screen bg-surface">
      <header className="border-b border-border bg-brand-black">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <span className="font-heading text-2xl font-semibold tracking-tight text-brand-cream">
            ZYVORA
          </span>
          <span className="text-sm text-brand-gold">
            Premium Car &amp; Bike Flags
          </span>
        </div>
      </header>

      <section className="border-b border-border bg-brand-cream">
        <div className="mx-auto max-w-6xl px-6 py-14">
          <h1 className="text-balance text-4xl font-semibold sm:text-5xl">
            Flags that move with you
          </h1>
          <p className="mt-3 max-w-xl text-text-secondary">
            Weather-resistant car and bike flags, mounting hardware and gift
            sets — built for daily pride and long road trips.
          </p>
        </div>
      </section>

      <main className="mx-auto max-w-6xl px-6 py-8">
        <div className="mb-6 flex flex-wrap items-center gap-3">
          <label htmlFor="sort" className="text-sm text-text-secondary">
            Sort
          </label>
          <select
            id="sort"
            value={sort}
            onChange={(e) => setSort(e.target.value as ProductSort)}
            className="rounded-md border border-border bg-surface-elevated px-3 py-2 text-sm"
          >
            <option value="name_asc">Name (A–Z)</option>
            <option value="name_desc">Name (Z–A)</option>
            <option value="price_asc">Price (low to high)</option>
            <option value="price_desc">Price (high to low)</option>
          </select>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setCategory(undefined)}
              className={`rounded-full border px-4 py-1.5 text-sm transition-colors ${
                category === undefined
                  ? 'border-brand-gold bg-brand-gold text-brand-black'
                  : 'border-border bg-surface-elevated text-text-secondary hover:border-brand-gold'
              }`}
            >
              All
            </button>
            {visibleCategories.map((c) => (
              <button
                key={c.slug}
                type="button"
                onClick={() => setCategory(c.slug as ProductCategory)}
                className={`rounded-full border px-4 py-1.5 text-sm transition-colors ${
                  category === c.slug
                    ? 'border-brand-gold bg-brand-gold text-brand-black'
                    : 'border-border bg-surface-elevated text-text-secondary hover:border-brand-gold'
                }`}
              >
                {c.name}
              </button>
            ))}
          </div>
        </div>

        {products.status === 'loading' && (
          <p className="py-16 text-center text-text-muted">
            Loading the catalogue…
          </p>
        )}

        {products.status === 'error' && (
          <div
            role="alert"
            className="rounded-lg border border-accent-red/30 bg-accent-red/5 p-6"
          >
            <h2 className="text-lg font-medium text-accent-red">
              Could not load the catalogue
            </h2>
            <p className="mt-1 text-sm text-text-secondary">
              {products.message}
            </p>
            <p className="mt-3 text-sm text-text-muted">
              Start the API with <code className="font-mono">npm run dev</code>{' '}
              and make sure PostgreSQL is running.
            </p>
          </div>
        )}

        {products.status === 'ready' && products.data.length === 0 && (
          <p className="py-16 text-center text-text-muted">
            No products in this category yet.
          </p>
        )}

        {products.status === 'ready' && products.data.length > 0 && (
          <>
            <p className="mb-4 text-sm text-text-muted">
              {products.data.length} of {total} product{total === 1 ? '' : 's'}
            </p>
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {products.data.map((p) => (
                <ProductCard key={p.id} product={p} />
              ))}
            </div>
          </>
        )}
      </main>

      <footer className="mt-12 border-t border-border">
        <div className="mx-auto max-w-6xl px-6 py-8 text-sm text-text-muted">
          ZYVORA — Premium Car/Bike Flag E-Commerce
        </div>
      </footer>
    </div>
  );
}
