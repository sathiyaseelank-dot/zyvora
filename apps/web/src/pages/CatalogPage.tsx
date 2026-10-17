import { useEffect, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { fetchProducts, searchProducts } from '../lib/api';
import { Button } from '../components/Button';
import { ProductImage } from '../components/ProductImage';

/**
 * Catalog (ZYV-105 is the full story; this is the shell the sprint needs so
 * the header's search and nav have somewhere real to go).
 *
 * Reads `?q=` and `?category=` from the URL, which is what makes the header
 * search form and the footer links work: both navigate, neither holds state.
 */

function rupees(value: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(value);
}

export function CatalogPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const q = searchParams.get('q') ?? '';
  const category = searchParams.get('category') ?? '';

  const [term, setTerm] = useState(q);
  const [items, setItems] = useState<
    | {
        id: string;
        name: string;
        price: number;
        category: string;
        image: string;
      }[]
    | null
  >(null);
  const [total, setTotal] = useState(0);
  const [failed, setFailed] = useState(false);

  useEffect(() => setTerm(q), [q]);

  useEffect(() => {
    const controller = new AbortController();
    setItems(null);
    setFailed(false);
    const run = q
      ? searchProducts(q, controller.signal)
      : fetchProducts(
          {
            pageSize: 24,
            ...(category ? { category: category as never } : {}),
          },
          controller.signal,
        );

    run
      .then((r) => {
        setItems(r.data);
        setTotal(
          'meta' in r && 'total' in r.meta
            ? (r.meta.total ?? 0)
            : r.data.length,
        );
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setFailed(true);
      });
    return () => controller.abort();
  }, [q, category]);

  function onSearch(event: FormEvent) {
    event.preventDefault();
    const next = new URLSearchParams(searchParams);
    if (term.trim()) next.set('q', term.trim());
    else next.delete('q');
    setSearchParams(next);
  }

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
        className="mt-8 flex max-w-[420px] items-center gap-3 border-b border-ink-muted/50 pb-2"
      >
        <label htmlFor="catalog-search" className="sr-only">
          Search flags
        </label>
        <input
          id="catalog-search"
          type="search"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Search by name or style"
          className="w-full bg-transparent text-[14px] outline-none"
        />
        <Button type="submit" size="sm">
          Search
        </Button>
      </form>

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
              {total} {total === 1 ? 'flag' : 'flags'}
            </p>
            <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-4">
              {items.map((product) => (
                <article key={product.id} className="group min-w-0">
                  <Link to={`/catalog/${product.id}`}>
                    <div className="aspect-4/5 overflow-hidden bg-paper-sunk">
                      <ProductImage
                        src={product.image}
                        alt={product.name}
                        className="h-full w-full object-cover saturate-[0.82] transition-transform duration-500 ease-[var(--ease-out-soft)] group-hover:scale-105"
                      />
                    </div>
                    <p className="mt-4 mb-1.5 text-[9px] font-bold tracking-[0.13em] text-brass-deep uppercase">
                      {product.category}
                    </p>
                    <div className="flex items-start justify-between gap-3">
                      <h2 className="font-display text-[17px]">
                        {product.name}
                      </h2>
                      <p className="shrink-0 text-[13px] font-semibold whitespace-nowrap">
                        {rupees(product.price)}
                      </p>
                    </div>
                  </Link>
                </article>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
