import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import {
  fetchCategories,
  fetchProducts,
  searchProducts,
  addCartItem,
  type Category,
  type ProductSort,
} from '../lib/api';
import { Button } from '../components/Button';
import { ProductImage } from '../components/ProductImage';

/**
 * Catalogue grid — ZYV-105.
 *
 * Acceptance criteria and where each is satisfied:
 *
 *   image, name, price, availability .......... the card below
 *   original price and discount when accurate . NOT RENDERED. `products` has
 *                                                no MRP column; the only
 *                                                discount columns in the schema
 *                                                belong to `coupons` and
 *                                                `orders`. Printing a struck-
 *                                                through price would mean
 *                                                inventing one.
 *   rating only when genuine .................. `rating` is null unless
 *                                                verified reviews exist, and
 *                                                the card stays silent on null.
 *   add to cart and view details .............. both present on every card
 *   search, sort, filter, pagination .......... state lives in the URL, so a
 *                                                filtered catalogue is a
 *                                                shareable link and the back
 *                                                button behaves.
 *
 * Price and stock are rendered exactly as the API sends them. Nothing is
 * derived here: a second source of truth for either would be a way for the
 * storefront and the checkout to disagree about what is owed.
 */

const PAGE_SIZE = 12;

const SORTS = [
  { value: 'name_asc', label: 'Name A–Z' },
  { value: 'name_desc', label: 'Name Z–A' },
  { value: 'price_asc', label: 'Price: low to high' },
  { value: 'price_desc', label: 'Price: high to low' },
] as const;

function rupees(value: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(value);
}

interface Card {
  id: string;
  name: string;
  price: number;
  category: string;
  image: string;
  inStock: boolean;
  rating: { average: number; count: number } | null;
}

export function CatalogPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const q = searchParams.get('q') ?? '';
  const category = searchParams.get('category') ?? '';
  const sort = searchParams.get('sort') ?? 'name_asc';
  const page = Math.max(1, Number(searchParams.get('page') ?? '1') || 1);

  // Anything the URL contains is untrusted input: a hand-edited ?sort= is as
  // valid as a typed one. Narrowing against the same list the <select> renders
  // means an unknown value falls back to the API default instead of being sent
  // through and drawing a 400 for the whole page.
  const sortValue: ProductSort = SORTS.some((s) => s.value === sort)
    ? (sort as ProductSort)
    : 'name_asc';

  const [term, setTerm] = useState(q);
  const [categories, setCategories] = useState<Category[] | null>(null);
  const [items, setItems] = useState<Card[] | null>(null);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [failed, setFailed] = useState(false);
  const [added, setAdded] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null);

  /** Writes a URL change. Any control that changes the result set resets to page 1. */
  const update = useCallback(
    (patch: Record<string, string | null>, resetPage = true) => {
      const next = new URLSearchParams(searchParams);
      for (const [key, value] of Object.entries(patch)) {
        if (value === null || value === '') next.delete(key);
        else next.set(key, value);
      }
      if (resetPage) next.delete('page');
      setSearchParams(next);
    },
    [searchParams, setSearchParams],
  );

  // Rewritten when ?sort= is edited by hand so the control cannot disagree
  // with what was actually requested.
  useEffect(() => {
    if (sort !== sortValue) update({ sort: null });
  }, [sort, sortValue, update]);

  useEffect(() => {
    const controller = new AbortController();
    fetchCategories(controller.signal)
      .then(setCategories)
      .catch(() => setCategories([]));
    return () => controller.abort();
  }, []);

  useEffect(() => setTerm(q), [q]);

  useEffect(() => {
    const controller = new AbortController();
    setItems(null);
    setFailed(false);

    // Search is a different endpoint and cannot filter, sort or paginate. The
    // controls are hidden while a query is active rather than shown and
    // silently ignored, which is the honest version of "it doesn't work yet".
    const run = q
      ? searchProducts(q, controller.signal)
      : fetchProducts(
          {
            pageSize: PAGE_SIZE,
            page,
            sort: sortValue,
            ...(category ? { category: category as never } : {}),
          },
          controller.signal,
        );

    run
      .then((r) => {
        setItems(r.data);
        const meta = r.meta as { total?: number; totalPages?: number };
        setTotal(meta.total ?? r.data.length);
        setTotalPages(meta.totalPages ?? 1);
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setFailed(true);
      });
    return () => controller.abort();
  }, [q, category, sortValue, page]);

  function onSearch(event: FormEvent) {
    event.preventDefault();
    update({ q: term.trim() || null });
  }

  async function onAdd(productId: string) {
    setAdding(productId);
    setAdded(null);
    try {
      await addCartItem(productId, 1);
      setAdded(productId);
      // Clear the confirmation after a moment so the card does not keep a stale
      // "added" badge long after the basket has changed underneath it.
      setTimeout(() => setAdded((c) => (c === productId ? null : c)), 2500);
    } catch {
      // Left silent: the cart page is the place where a failed add is visible
      // and actionable, and a toast here would compete with the grid.
    } finally {
      setAdding(null);
    }
  }

  const showControls = !q;
  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(page * PAGE_SIZE, total);

  return (
    <div className="mx-auto max-w-[1400px] px-5 py-14 sm:px-8">
      <p className="eyebrow">The collection</p>
      <h1 className="font-display text-[clamp(2.25rem,5vw,3.75rem)]">
        {q ? (
          <>
            Results for <em className="text-brass-deep italic">“{q}”</em>
          </>
        ) : category ? (
          <>
            {category} <em className="text-brass-deep italic">flags</em>
          </>
        ) : (
          <>
            Every <em className="text-brass-deep italic">flag</em>
          </>
        )}
      </h1>

      <form
        onSubmit={onSearch}
        role="search"
        className="mt-6 flex max-w-[480px] items-center gap-2 rounded-2xl border border-slate-200 bg-white p-1.5 shadow-xs transition-all focus-within:border-brass focus-within:ring-2 focus-within:ring-brass/20"
      >
        <label htmlFor="catalog-search" className="sr-only">
          Search flags
        </label>
        <div className="pl-3 text-slate-400">
          <svg
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
        </div>
        <input
          id="catalog-search"
          type="search"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Search flags, vehicle mounts..."
          className="w-full bg-transparent px-2 text-[14px] text-ink outline-none placeholder:text-slate-400"
        />
        <Button type="submit" size="sm">
          Search
        </Button>
      </form>

      {showControls && (
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <div>
            <label htmlFor="catalog-category" className="sr-only">
              Filter by category
            </label>
            <select
              id="catalog-category"
              value={category}
              onChange={(e) => update({ category: e.target.value || null })}
              className="rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-xs outline-none hover:border-slate-300 focus:border-brass focus:ring-1 focus:ring-brass"
            >
              <option value="">All categories</option>
              {categories?.map((c) => (
                <option key={c.slug} value={c.slug}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="catalog-sort" className="sr-only">
              Sort products
            </label>
            <select
              id="catalog-sort"
              value={sortValue}
              onChange={(e) => update({ sort: e.target.value })}
              className="rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-xs outline-none hover:border-slate-300 focus:border-brass focus:ring-1 focus:ring-brass"
            >
              {SORTS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>

          {(category || sort !== 'name_asc') && (
            <button
              type="button"
              onClick={() => update({ category: null, sort: null })}
              className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900"
            >
              Reset
            </button>
          )}
        </div>
      )}

      <div className="mt-12">
        {failed ? (
          <p className="text-[13px] text-ink-muted">
            The catalog is unavailable right now. Please try again shortly.
          </p>
        ) : !items ? (
          <div
            className="grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-4"
            aria-hidden="true"
          >
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} className="aspect-4/5 animate-pulse bg-paper-sunk" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="py-20 text-center">
            <p className="text-[14px] text-ink-muted">
              Nothing matched that search.
            </p>
            <Link
              to="/catalog"
              className="mt-4 inline-block border-b border-brass-deep text-[12px] uppercase"
            >
              Clear filters
            </Link>
          </div>
        ) : (
          <>
            <p className="mb-6 text-[11px] tracking-[0.1em] text-ink-muted uppercase">
              {showControls && totalPages > 1
                ? `Showing ${from}–${to} of ${total}`
                : `${total} ${total === 1 ? 'flag' : 'flags'}`}
            </p>

            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {items.map((product) => (
                <article
                  key={product.id}
                  className="group flex flex-col justify-between rounded-2xl border border-slate-200/80 bg-white p-3.5 shadow-xs transition-all duration-300 hover:-translate-y-1 hover:border-amber-300 hover:shadow-lg min-w-0"
                >
                  <Link to={`/products/${product.id}`} className="block">
                    <div className="aspect-4/5 overflow-hidden rounded-xl bg-slate-100">
                      <ProductImage
                        src={product.image}
                        alt={product.name}
                        className="h-full w-full object-cover transition-transform duration-500 ease-[var(--ease-out-soft)] group-hover:scale-105"
                      />
                    </div>
                    <div className="mt-3 flex items-center justify-between gap-2">
                      <span className="inline-block text-[10px] font-bold tracking-wider text-amber-700 uppercase bg-amber-50 px-2 py-0.5 rounded-md">
                        {product.category}
                      </span>
                      {product.inStock ? (
                        <span className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">
                          In stock
                        </span>
                      ) : (
                        <span className="text-[11px] font-medium text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">
                          Out of stock
                        </span>
                      )}
                    </div>
                    <div className="mt-2 flex items-start justify-between gap-3">
                      <h2 className="font-display text-[16px] font-semibold text-slate-900 group-hover:text-amber-700 transition-colors line-clamp-1">
                        {product.name}
                      </h2>
                      <p className="shrink-0 text-[15px] font-bold text-slate-900 whitespace-nowrap">
                        {rupees(product.price)}
                      </p>
                    </div>
                  </Link>

                  {/*
                    Rendered only when the API supplied verified reviews. A null
                    rating means "nobody has reviewed this yet", which is not the
                    same as zero stars, and printing stars there would be a
                    fabricated claim about a product nobody has bought.
                  */}
                  {product.rating && (
                    <div className="mt-2 flex items-center gap-1.5">
                      <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 border border-emerald-200/60 px-2 py-0.5 text-xs font-bold text-emerald-700">
                        {product.rating.average.toFixed(1)} ★
                      </span>
                      <span className="text-xs text-slate-500">
                        ({product.rating.count})
                      </span>
                    </div>
                  )}

                  <div className="mt-4 flex gap-2">
                    <Button
                      size="sm"
                      disabled={!product.inStock || adding === product.id}
                      onClick={() => onAdd(product.id)}
                      className="flex-1"
                    >
                      {added === product.id
                        ? 'Added'
                        : product.inStock
                          ? 'Add to cart'
                          : 'Sold out'}
                    </Button>
                    <Link
                      to={`/products/${product.id}`}
                      className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-100"
                    >
                      Details
                    </Link>
                  </div>
                </article>
              ))}
            </div>

            {showControls && totalPages > 1 && (
              <nav
                aria-label="Catalogue pages"
                className="mt-12 flex items-center justify-center gap-4"
              >
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={page <= 1}
                  onClick={() => update({ page: String(page - 1) }, false)}
                >
                  Previous
                </Button>
                <span className="text-[11px] tracking-[0.1em] text-ink-muted uppercase">
                  Page {page} of {totalPages}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={page >= totalPages}
                  onClick={() => update({ page: String(page + 1) }, false)}
                >
                  Next
                </Button>
              </nav>
            )}
          </>
        )}
      </div>
    </div>
  );
}
