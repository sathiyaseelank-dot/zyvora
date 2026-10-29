import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import {
  fetchCart,
  removeCartItem,
  updateCartItem,
  ApiRequestError,
  type Cart,
} from '../lib/api';
import { ButtonLink } from '../components/Button';
import { ProductImage } from '../components/ProductImage';

/**
 * Shopping cart (ZYV-113).
 *
 * Replaces the placeholder that stood in during Sprint 4, which existed
 * because the cart API did not.
 *
 * Every mutation returns the whole recomputed cart, and that response becomes
 * the new state. Nothing is recalculated here: the server owns price, stock,
 * shipping and the free-delivery threshold, and the browser holds none of it.
 * Optimistically incrementing a quantity would be the fastest way to show a
 * shopper a total the order will not honour.
 */

function rupees(value: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(value);
}

export function CartPage() {
  const [cart, setCart] = useState<Cart | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Item currently mutating, so one row shows a spinner and the rest stay usable. */
  const [busyItem, setBusyItem] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetchCart(controller.signal)
      .then(setCart)
      .catch((err) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setFailed(true);
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, []);

  /**
   * Run a mutation and adopt whatever the server sends back.
   *
   * On failure the cart is re-read instead of being patched locally: a stock
   * rejection means the server's view already differs from ours, and leaving
   * the stale number on screen would be the actual bug.
   */
  const mutate = useCallback(
    async (work: () => Promise<Cart>, itemId: string) => {
      setBusyItem(itemId);
      setError(null);
      try {
        setCart(await work());
      } catch (err) {
        setError(
          err instanceof ApiRequestError
            ? err.message
            : 'Could not update your cart. Please try again.',
        );
        try {
          setCart(await fetchCart());
        } catch {
          setFailed(true);
        }
      } finally {
        setBusyItem(null);
      }
    },
    [],
  );

  if (loading) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="mx-auto max-w-[1100px] px-5 py-24"
      >
        <p className="text-[11px] tracking-[0.14em] text-ink-muted uppercase">
          Loading your cart…
        </p>
      </div>
    );
  }

  if (failed) {
    return (
      <div className="mx-auto max-w-[560px] px-5 py-24 text-center">
        <p className="eyebrow eyebrow--centred">Your cart</p>
        <h1 className="font-display text-[clamp(2rem,5vw,3rem)]">
          We could not load your cart
        </h1>
        <p className="mx-auto mt-5 max-w-[44ch] text-[14px] leading-relaxed text-ink-soft">
          The shop is not answering just now. Your basket is safe — try again in
          a moment.
        </p>
        <ButtonLink to="/catalog" variant="outline" size="md" className="mt-8">
          Browse flags
        </ButtonLink>
      </div>
    );
  }

  const lines = cart?.lines ?? [];
  const totals = cart?.totals;

  if (lines.length === 0) {
    return (
      <div className="mx-auto max-w-[560px] px-5 py-24 text-center">
        <p className="eyebrow eyebrow--centred">Your cart</p>
        <h1 className="font-display text-[clamp(2rem,5vw,3rem)]">
          Nothing in the basket
        </h1>
        <p className="mx-auto mt-5 max-w-[42ch] text-[14px] leading-relaxed text-ink-soft">
          Flags you add are kept here for 30 days, so you can come back to them.
        </p>
        <ButtonLink to="/catalog" variant="brass" size="lg" className="mt-9">
          Browse the collection
        </ButtonLink>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1100px] px-5 py-14 sm:px-8">
      <p className="eyebrow">Your cart</p>
      <h1 className="font-display text-[clamp(2.25rem,5vw,3.5rem)]">
        {totals?.itemCount} {totals?.itemCount === 1 ? 'flag' : 'flags'}
      </h1>

      {/* role="alert" on a permanently rendered node, for the same reason as
          the form banners: a live region inserted with its own text is often
          missed by screen readers. */}
      <div role="alert" aria-live="assertive" className={error ? 'mt-6' : ''}>
        {error ? (
          <div className="flex items-start gap-2 border border-danger/30 bg-danger-soft px-4 py-3">
            <span aria-hidden="true" className="text-danger">
              ⚠
            </span>
            <p className="text-[13px] text-danger">{error}</p>
          </div>
        ) : null}
      </div>

      <div className="mt-10 grid gap-10 lg:grid-cols-[1fr_320px] lg:gap-14">
        <ul className="divide-y divide-slate-200/80">
          {lines.map((line) => {
            const busy = busyItem === line.itemId;
            const short = line.available <= 5 && line.available > 0;
            return (
              <li
                key={line.itemId}
                className={`flex gap-5 py-6 rounded-2xl bg-white border border-slate-200/70 p-4 mb-4 shadow-xs ${busy ? 'opacity-60' : ''}`}
              >
                <Link
                  to={`/catalog/${line.productId}`}
                  className="w-[96px] shrink-0 overflow-hidden rounded-xl bg-slate-100"
                >
                  <ProductImage
                    src={line.image}
                    alt={line.name}
                    className="aspect-[3/4] w-full object-cover"
                  />
                </Link>

                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <div className="flex items-start justify-between gap-4">
                    <h2 className="font-display text-[17px] font-semibold text-slate-900 hover:text-amber-700 transition-colors">
                      <Link to={`/catalog/${line.productId}`}>{line.name}</Link>
                    </h2>
                    <p className="shrink-0 text-[16px] font-bold text-slate-900 whitespace-nowrap">
                      {rupees(line.lineTotal)}
                    </p>
                  </div>

                  <p className="text-[12px] text-slate-500">
                    {rupees(line.unitPrice)} each
                  </p>

                  {short ? (
                    <p className="text-[12px] font-medium text-danger">
                      Only {line.available} left in stock
                    </p>
                  ) : null}
                  {line.available === 0 ? (
                    <p className="text-[12px] font-medium text-danger">
                      Out of stock — remove to continue
                    </p>
                  ) : null}

                  <div className="mt-2 flex items-center gap-4">
                    {/* Quantity stepper: real buttons, so it is keyboard
                        operable and the value is announced rather than a div
                        that only responds to clicks. */}
                    <div className="inline-flex items-center rounded-xl border border-slate-200 bg-slate-50 p-0.5">
                      <button
                        type="button"
                        disabled={busy || line.quantity <= 1}
                        onClick={() =>
                          void mutate(
                            () =>
                              updateCartItem(line.itemId, line.quantity - 1),
                            line.itemId,
                          )
                        }
                        className="flex h-7 w-7 items-center justify-center rounded-lg text-[14px] font-bold text-slate-700 transition-colors hover:bg-white hover:text-brass-deep disabled:opacity-30 disabled:hover:text-ink"
                      >
                        <span aria-hidden="true">−</span>
                        <span className="sr-only">
                          Reduce quantity of {line.name}
                        </span>
                      </button>
                      <span
                        aria-live="polite"
                        className="min-w-[2.5ch] px-2 text-center text-xs font-semibold text-slate-900"
                      >
                        <span aria-hidden="true">{line.quantity}</span>
                        <span className="sr-only">
                          Quantity of {line.name}: {line.quantity}
                        </span>
                      </span>
                      <button
                        type="button"
                        disabled={busy || line.quantity >= line.available}
                        onClick={() =>
                          void mutate(
                            () =>
                              updateCartItem(line.itemId, line.quantity + 1),
                            line.itemId,
                          )
                        }
                        className="flex h-7 w-7 items-center justify-center rounded-lg text-[14px] font-bold text-slate-700 transition-colors hover:bg-white hover:text-brass-deep disabled:opacity-30 disabled:hover:text-ink"
                      >
                        <span aria-hidden="true">+</span>
                        <span className="sr-only">
                          Increase quantity of {line.name}
                        </span>
                      </button>
                    </div>

                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void mutate(
                          () => removeCartItem(line.itemId),
                          line.itemId,
                        )
                      }
                      className="text-xs font-semibold text-slate-500 transition-colors hover:text-red-600 disabled:opacity-40"
                    >
                      <span aria-hidden="true">Remove</span>
                      <span className="sr-only">Remove {line.name}</span>
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>

        {/* Totals come from the server as computed. Nothing is summed here. */}
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <div className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-xs">
            <h2 className="font-display text-[20px] font-bold text-slate-900">Summary</h2>

            <dl className="mt-5 grid gap-2.5 text-[13px]">
              <div className="flex justify-between">
                <dt className="text-ink-soft">Subtotal</dt>
                <dd>{rupees(totals?.subtotal ?? 0)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink-soft">Shipping</dt>
                <dd>
                  {totals?.shipping === 0
                    ? 'Free'
                    : rupees(totals?.shipping ?? 0)}
                </dd>
              </div>
              <div className="mt-2 flex justify-between border-t border-rule pt-3 text-[16px] font-semibold">
                <dt>Total</dt>
                <dd>{rupees(totals?.total ?? 0)}</dd>
              </div>
            </dl>

            {/*
              The threshold and shortfall are server figures. A client copy of
              "₹2,000" would quietly go stale if the threshold ever changed.
            */}
            {totals && totals.amountToFreeShipping > 0 ? (
              <p className="mt-4 text-[12px] leading-relaxed text-ink-muted">
                Add {rupees(totals.amountToFreeShipping)} more for free
                delivery.
              </p>
            ) : (
              <p className="mt-4 text-[12px] text-success">
                Free delivery applied.
              </p>
            )}

            <ButtonLink
              to="/checkout"
              variant="brass"
              size="lg"
              fullWidth
              className="mt-6"
            >
              Proceed to checkout
            </ButtonLink>
            <ButtonLink
              to="/catalog"
              variant="outline"
              size="md"
              fullWidth
              className="mt-3"
            >
              Continue shopping
            </ButtonLink>
          </div>
        </aside>
      </div>
    </div>
  );
}
