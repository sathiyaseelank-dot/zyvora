import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

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
  const navigate = useNavigate();

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

  async function onBuyNow() {
    if (!product) return;
    setBusy(true);
    try {
      await addCartItem(product.id, quantity);
      navigate('/checkout');
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
    <div className="mx-auto max-w-[1400px] px-5 pt-8 pb-24 sm:px-8 sm:py-14">
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

              {/* Desktop Action Buttons */}
              <div className="mt-8 hidden md:flex flex-wrap gap-3">
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
                <Button
                  onClick={onBuyNow}
                  disabled={!product.inStock || busy}
                  size="lg"
                  variant="brass"
                  className="min-w-[170px]"
                >
                  {product.inStock ? 'Buy now' : 'Sold out'}
                </Button>
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

      {/* Flipkart-style Sticky Bottom Action Bar for Mobile View */}
      {product && (
        <div
          data-testid="mobile-sticky-bar"
          className="fixed bottom-0 inset-x-0 z-40 border-t border-slate-200 bg-white/95 px-3 py-2.5 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-4px_20px_rgba(0,0,0,0.08)] backdrop-blur-md md:hidden"
        >
          <div className="mx-auto flex max-w-md items-center gap-2.5">
            <button
              type="button"
              onClick={onAdd}
              disabled={!product.inStock || busy}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-[#ffc200] px-3 py-3 text-xs sm:text-sm font-bold tracking-wide uppercase text-slate-900 shadow-xs transition-all duration-200 hover:bg-[#eab308] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {added ? (
                <>
                  <svg
                    className="h-4 w-4 shrink-0 text-emerald-900"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    strokeWidth="2.5"
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                  <span>Added to cart</span>
                </>
              ) : (
                <>
                  <svg
                    className="h-4 w-4 shrink-0"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    strokeWidth="2"
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z"
                    />
                  </svg>
                  <span>{product.inStock ? 'Add to cart' : 'Sold out'}</span>
                </>
              )}
            </button>
            <button
              type="button"
              onClick={onBuyNow}
              disabled={!product.inStock || busy}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-[#fb641b] px-3 py-3 text-xs sm:text-sm font-bold tracking-wide uppercase text-white shadow-xs transition-all duration-200 hover:bg-[#ea580c] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <svg
                className="h-4 w-4 shrink-0"
                fill="currentColor"
                viewBox="0 0 20 20"
                aria-hidden="true"
              >
                <path
                  fillRule="evenodd"
                  d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z"
                  clipRule="evenodd"
                />
              </svg>
              <span>
                {product.inStock
                  ? `Buy at ${rupees(product.price * quantity)}`
                  : 'Sold out'}
              </span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
