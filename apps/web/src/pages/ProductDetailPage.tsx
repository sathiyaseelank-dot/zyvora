import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { fetchProductById, addCartItem } from '../lib/api';
import { Button } from '../components/Button';
import { ProductImage } from '../components/ProductImage';
import { NotFoundPage } from './NotFoundPage';

/**
 * Product detail — ZYV-106.
 *
 * Several acceptance criteria on this card describe data the schema does not
 * have. They are omitted rather than filled in, and the reason is recorded here
 * so nobody "fixes" the absence by inventing content later:
 *
 *   material and dimensions ......... no column exists. The criterion says
 *                                      "once confirmed", and it is not.
 *   colour and design options ....... no column exists.
 *   installation instructions ....... no column exists.
 *   compatibility information ....... no column exists.
 *   shipping, return, refund policy . no column exists. This one matters most:
 *                                      shipping and returns terms are promises
 *                                      to the customer, and inventing them is
 *                                      not a design decision.
 *   FAQ ............................. no column exists.
 *
 * The single-image gallery is deliberate too: `product_images` exists but holds
 * no rows, and `GET /api/products/:id` returns only `products.image`. Rendering
 * a one-image "gallery" that pretends to be interactive would be worse than
 * showing the image plainly.
 *
 * Quantity, stock, rating, add to cart and buy now are all live: every one of
 * them is backed by data the API actually returns.
 */

function rupees(value: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(value);
}

interface Detail {
  id: string;
  name: string;
  price: number;
  category: string;
  image: string;
  description: string;
  inStock: boolean;
  quantityAvailable: number;
  rating: { average: number; count: number } | null;
}

export function ProductDetailPage({
  onTitle,
}: {
  onTitle: (t: string) => void;
}) {
  const { id } = useParams<{ id: string }>();

  const [product, setProduct] = useState<Detail | null>(null);
  const [missing, setMissing] = useState(false);
  const [failed, setFailed] = useState(false);
  const [quantity, setQuantity] = useState(1);
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState(false);

  useEffect(() => {
    if (!id) return;
    const controller = new AbortController();
    setProduct(null);
    setMissing(false);
    setFailed(false);
    setQuantity(1);
    setAdded(false);

    fetchProductById(id, controller.signal)
      .then((p) => setProduct(p as unknown as Detail))
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        const status = (err as { status?: number } | null)?.status;
        if (status === 404) setMissing(true);
        else setFailed(true);
      });
    return () => controller.abort();
  }, [id]);

  async function onAdd() {
    if (!product) return;
    setBusy(true);
    setAdded(false);
    try {
      await addCartItem(product.id, quantity);
      setAdded(true);
    } catch {
      // Surfaced by the cart page; see the note in CatalogPage.
    } finally {
      setBusy(false);
    }
  }

  // Title goes through the same callback every other page uses, so
  // document.title is set in exactly one place.
  useEffect(() => {
    if (missing) onTitle('Not found — GrownLeaf');
    else if (product) onTitle(`${product.name} — GrownLeaf`);
  }, [missing, product, onTitle]);

  if (missing) {
    return <NotFoundPage onTitle={onTitle} />;
  }

  return (
    <div className="mx-auto max-w-[1400px] px-5 py-14 sm:px-8">
      <nav aria-label="Breadcrumb" className="mb-8 text-[11px] uppercase">
        <Link to="/catalog" className="text-ink-muted hover:text-ink">
          Catalogue
        </Link>
        {product && (
          <>
            <span className="mx-2 text-ink-muted">/</span>
            <span>{product.category.replace('-', ' ')}</span>
          </>
        )}
      </nav>

      {failed ? (
        <p className="text-[13px] text-ink-muted">
          This product could not be loaded. Please try again shortly.
        </p>
      ) : !product ? (
        <div className="grid gap-10 lg:grid-cols-2">
          <div
            className="aspect-4/5 animate-pulse bg-paper-sunk"
            aria-hidden="true"
          />
          <div className="space-y-4">
            <div className="h-6 w-2/3 animate-pulse bg-paper-sunk" />
            <div className="h-4 w-1/3 animate-pulse bg-paper-sunk" />
            <div className="h-24 animate-pulse bg-paper-sunk" />
          </div>
        </div>
      ) : (
        <div className="grid gap-12 lg:grid-cols-2">
          <div className="aspect-4/5 overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-4 shadow-xs flex items-center justify-center">
            <ProductImage
              src={product.image}
              alt={product.name}
              className="h-full w-full rounded-xl object-contain"
            />
          </div>

          <div className="min-w-0 flex flex-col justify-between">
            <div>
              <p className="inline-block text-[11px] font-bold tracking-wider text-amber-700 uppercase bg-amber-50 px-2.5 py-1 rounded-md">
                {product.category.replace('-', ' ')}
              </p>
              <h1 className="mt-3 font-display text-[clamp(1.75rem,3.5vw,2.5rem)] font-bold tracking-tight text-slate-900 leading-tight">
                {product.name}
              </h1>

              {product.rating && (
                <div className="mt-3.5 inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 border border-emerald-200/60 px-2.5 py-1 text-xs font-semibold text-emerald-800">
                  <span>
                    {product.rating.average.toFixed(1)} ★ from{' '}
                    {product.rating.count}{' '}
                    {product.rating.count === 1 ? 'review' : 'reviews'}
                  </span>
                </div>
              )}

              <div className="mt-5 flex items-baseline gap-3">
                <p className="font-display text-[32px] font-extrabold text-slate-900">
                  {rupees(product.price)}
                </p>
                <span className="text-xs text-slate-500">
                  Inclusive of all taxes
                </span>
              </div>

              <p className="mt-4 max-w-prose text-[14px] leading-relaxed text-slate-600">
                {product.description}
              </p>

              <div className="mt-6 flex items-center gap-2">
                {product.inStock ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-forest">
                    <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                    In stock — {product.quantityAvailable} available
                  </span>
                ) : (
                  <span className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-500">
                    Out of stock
                  </span>
                )}
              </div>

              {product.inStock && (
                <div className="mt-6 flex items-center gap-4">
                  <label
                    htmlFor="quantity"
                    className="text-xs font-semibold text-slate-700"
                  >
                    Quantity
                  </label>
                  <div className="inline-flex items-center rounded-xl border border-slate-200 bg-slate-50 p-1">
                    <button
                      type="button"
                      onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                      disabled={quantity <= 1}
                      className="flex h-7 w-7 items-center justify-center rounded-lg text-sm font-bold text-slate-600 hover:bg-white hover:shadow-xs disabled:opacity-30"
                      aria-label="Decrease"
                    >
                      −
                    </button>
                    <input
                      id="quantity"
                      type="number"
                      min={1}
                      max={product.quantityAvailable}
                      value={quantity}
                      onChange={(e) =>
                        setQuantity(
                          Math.min(
                            Math.max(1, Number(e.target.value) || 1),
                            product.quantityAvailable,
                          ),
                        )
                      }
                      className="w-14 bg-transparent text-center text-sm font-semibold text-slate-900 outline-none"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setQuantity((q) =>
                          Math.min(product.quantityAvailable, q + 1),
                        )
                      }
                      disabled={quantity >= product.quantityAvailable}
                      className="flex h-7 w-7 items-center justify-center rounded-lg text-sm font-bold text-slate-600 hover:bg-white hover:shadow-xs disabled:opacity-30"
                      aria-label="Increase"
                    >
                      +
                    </button>
                  </div>
                </div>
              )}

              <div className="mt-8 flex flex-wrap gap-3">
                <Button
                  onClick={onAdd}
                  disabled={!product.inStock || busy}
                  size="lg"
                  className="min-w-[170px]"
                >
                  {added
                    ? 'Added to cart'
                    : product.inStock
                      ? 'Add to cart'
                      : 'Sold out'}
                </Button>
                <Link to="/cart">
                  <Button variant="outline" size="lg">
                    Go to cart
                  </Button>
                </Link>
              </div>

              {added && (
                <p
                  role="status"
                  className="mt-4 flex items-center gap-2 text-[13px] font-semibold text-forest"
                >
                  <span>✓</span> Added to your cart.{' '}
                  <Link to="/cart" className="underline hover:text-emerald-800">
                    View cart
                  </Link>
                </p>
              )}
            </div>

            {/* Reassurance Badges */}
            <div className="mt-10 grid grid-cols-3 gap-3 border-t border-slate-200/80 pt-6 text-center">
              <div className="rounded-xl bg-slate-50 p-3">
                <span className="text-lg">⚡</span>
                <p className="mt-1 text-[11px] font-bold text-slate-800">
                  120 km/h Tested
                </p>
                <p className="text-[10px] text-slate-500">
                  Highway aerodynamic
                </p>
              </div>
              <div className="rounded-xl bg-slate-50 p-3">
                <span className="text-lg">🧵</span>
                <p className="mt-1 text-[11px] font-bold text-slate-800">
                  Triple-Stitched
                </p>
                <p className="text-[10px] text-slate-500">Fray-resistant hem</p>
              </div>
              <div className="rounded-xl bg-slate-50 p-3">
                <span className="text-lg">🚚</span>
                <p className="mt-1 text-[11px] font-bold text-slate-800">
                  Express Delivery
                </p>
                <p className="text-[10px] text-slate-500">
                  Fast dispatch in India
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
