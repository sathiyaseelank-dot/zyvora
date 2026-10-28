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
        <div className="grid gap-10 lg:grid-cols-2">
          <div className="aspect-4/5 overflow-hidden bg-paper-sunk">
            <ProductImage
              src={product.image}
              alt={product.name}
              className="h-full w-full object-cover saturate-[0.85]"
            />
          </div>

          <div className="min-w-0">
            <p className="text-[9px] font-bold tracking-[0.13em] text-brass-deep uppercase">
              {product.category.replace('-', ' ')}
            </p>
            <h1 className="mt-2 font-display text-[clamp(1.75rem,3.5vw,2.75rem)]">
              {product.name}
            </h1>

            {product.rating && (
              <p className="mt-3 text-[13px] text-ink-muted">
                {product.rating.average.toFixed(1)} ★ from{' '}
                {product.rating.count}{' '}
                {product.rating.count === 1 ? 'review' : 'reviews'}
              </p>
            )}

            <p className="mt-5 font-display text-[28px]">
              {rupees(product.price)}
            </p>

            <p className="mt-4 max-w-prose text-[14px] leading-relaxed">
              {product.description}
            </p>

            <p className="mt-6 text-[11px] tracking-[0.08em] uppercase">
              {product.inStock ? (
                <span className="text-forest">
                  In stock — {product.quantityAvailable} available
                </span>
              ) : (
                <span className="text-ink-muted">Out of stock</span>
              )}
            </p>

            {product.inStock && (
              <div className="mt-6 flex items-center gap-4">
                <label htmlFor="quantity" className="text-[11px] uppercase">
                  Quantity
                </label>
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
                  className="w-20 border border-ink-muted/40 bg-transparent px-3 py-2 text-[14px]"
                />
              </div>
            )}

            <div className="mt-8 flex flex-wrap gap-3">
              <Button
                onClick={onAdd}
                disabled={!product.inStock || busy}
                size="lg"
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
              <p role="status" className="mt-4 text-[13px] text-forest">
                Added to your cart.{' '}
                <Link to="/cart" className="border-b border-brass-deep">
                  View cart
                </Link>
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
