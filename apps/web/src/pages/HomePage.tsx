import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ProductSummary } from '@zyvora/types';

import { fetchProducts } from '../lib/api';
import { ButtonLink } from '../components/Button';
import { ProductImage } from '../components/ProductImage';

/**
 * Home page (ZYV-96 shell, ZYV-112 structure).
 *
 * Deliberately renders from the live catalog so the design system is judged
 * against real data — the seed set — rather than lorem. If the API is down the
 * page still lays out correctly; the product strip simply shows its skeleton.
 */

function ProductStrip() {
  const [products, setProducts] = useState<ProductSummary[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetchProducts({ pageSize: 3 }, controller.signal)
      .then((r) => setProducts(r.data))
      .catch((err) => {
        // An aborted fetch is the effect cleaning up, not a failure.
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setFailed(true);
      });
    return () => controller.abort();
  }, []);

  if (failed) {
    return (
      <p className="text-[13px] text-ink-muted">
        Flags are unavailable right now. Please try again shortly.
      </p>
    );
  }

  if (!products) {
    return (
      <div className="grid grid-cols-2 gap-6 sm:grid-cols-3" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <div key={i} className="aspect-4/5 animate-pulse bg-paper-sunk" />
        ))}
      </div>
    );
  }

  if (products.length === 0) {
    return (
      <p className="text-[13px] text-ink-muted">No flags published yet.</p>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-6 sm:grid-cols-3">
      {products.map((product) => (
        <Link
          key={product.id}
          to={`/catalog/${product.id}`}
          className="group block min-w-0"
        >
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
            <h3 className="font-display text-[17px]">{product.name}</h3>
            <p className="shrink-0 text-[13px] font-semibold whitespace-nowrap">
              {formatPrice(product.price)}
            </p>
          </div>
        </Link>
      ))}
    </div>
  );
}

function formatPrice(rupees: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(rupees);
}

const TICKER = [
  'Free shipping over ₹2,000',
  'Hand-finished in Chennai',
  'Weatherproof to 120 km/h',
  '30-day returns',
];

export function HomePage() {
  return (
    <>
      {/* Hero — an ink ground, so the whole page does not read as one block. */}
      <section className="on-ground grid min-h-[520px] bg-ground text-on-ground lg:grid-cols-[44fr_56fr]">
        <div className="relative z-10 flex flex-col items-start justify-center px-6 py-16 sm:px-10 lg:px-[clamp(2rem,8vw,7.5rem)]">
          <p className="eyebrow">Premium car &amp; bike flags</p>
          <h1 className="font-display text-[clamp(3.25rem,7vw,5.75rem)] leading-[0.94]">
            Flags that <em className="text-brass-glow italic">fly</em> first.
          </h1>
          <p className="mt-6 max-w-[38ch] text-[15px] leading-[1.7] text-on-ground-muted">
            Triple-stitched, UV-stabilised and cut to the wind. Built for the
            road, not the shelf.
          </p>
          <div className="mt-8 flex flex-wrap gap-4">
            <ButtonLink to="/catalog" variant="brass" size="lg">
              Shop flags <span aria-hidden="true">→</span>
            </ButtonLink>
            <ButtonLink
              to="/about"
              variant="ghost"
              size="lg"
              className="text-on-ground hover:text-brass-glow hover:border-brass-glow/40"
            >
              Our craft
            </ButtonLink>
          </div>
        </div>

        {/* CSS-only flag: three skewed bands on a pole. No image needed. */}
        <div
          className="relative hidden min-h-[420px] overflow-hidden bg-gradient-to-br from-[#2a2927] to-[#101010] lg:block"
          aria-hidden="true"
        >
          <div className="absolute top-[13%] right-[15%] h-[420px] w-[420px] rounded-full bg-[#bc8e3e]/20 blur-2xl" />
          <div className="absolute top-[23%] right-[3%] z-1 h-[54%] w-[78%] origin-top-right -skew-y-[9deg] -rotate-[7deg] drop-shadow-[0_24px_25px_rgba(0,0,0,0.5)]">
            <div className="absolute inset-y-0 left-[4%] w-[38%] -skew-x-[10deg] bg-flag-yellow [clip-path:polygon(0_5%,100%_0,83%_97%,0_82%)]" />
            <div className="absolute inset-y-0 left-[31%] w-[38%] -skew-x-[10deg] bg-flag-red [clip-path:polygon(15%_0,100%_9%,82%_100%,0_89%)]" />
            <div className="absolute inset-y-0 left-[57%] w-[38%] -skew-x-[10deg] bg-flag-cream [clip-path:polygon(17%_5%,100%_16%,100%_85%,0_97%)]" />
          </div>
          <div className="absolute top-[-12%] right-[4%] h-[135%] w-[5px] rotate-[2deg] bg-[#d4c39e]" />
        </div>
      </section>

      {/* Ticker */}
      <div className="overflow-hidden bg-brass py-3">
        <ul className="flex justify-around gap-8 whitespace-nowrap">
          {TICKER.map((item) => (
            <li
              key={item}
              className="text-[9px] font-bold tracking-[0.18em] text-ground-deep uppercase"
            >
              {item}
            </li>
          ))}
        </ul>
      </div>

      {/* Featured */}
      <section className="mx-auto max-w-[1400px] px-5 py-20 sm:px-8">
        <div className="mb-10 flex flex-wrap items-end justify-between gap-6">
          <div>
            <p className="eyebrow">The collection</p>
            <h2 className="font-display text-[clamp(2.25rem,5vw,3.75rem)]">
              Flags worth <em className="text-brass-deep italic">flying</em>
            </h2>
          </div>
          <Link
            to="/catalog"
            className="flex items-center gap-3 border-b border-brass-deep pb-2 text-[10px] font-bold tracking-[0.14em] uppercase transition-colors hover:text-brass-deep"
          >
            View all <span aria-hidden="true">→</span>
          </Link>
        </div>

        <ProductStrip />
      </section>

      {/* Craft */}
      <section className="grid bg-paper-sunk lg:grid-cols-2">
        <div
          className="min-h-[320px] bg-gradient-to-br from-[#3a3733] to-[#1a1918] lg:min-h-[460px]"
          aria-hidden="true"
        />
        <div className="flex flex-col items-start justify-center px-6 py-16 sm:px-10 lg:px-[clamp(2.5rem,8vw,7rem)]">
          <p className="eyebrow">Our craft</p>
          <h2 className="font-display text-[clamp(2.25rem,5vw,3.75rem)]">
            Cut for the <em className="text-brass-deep italic">wind</em>
          </h2>
          <p className="mt-7 max-w-[46ch] text-[14px] leading-[1.8] text-ink-soft">
            Every flag is cut from UV-stabilised polyester and finished with
            double-stitched hems along the fly edge — the part that frays first.
            Aluminium clips are tested to 120 km/h on our own road, not a
            laboratory rig.
          </p>
          <ul className="mt-7 grid gap-3 text-[13px] text-ink-soft">
            {[
              'Triple-stitched fly edge',
              'UV-stable, fade-resistant dyes',
              'Aluminium clips, rust-proof',
              'Cold-wash, no shrinkage',
            ].map((item) => (
              <li key={item} className="flex items-center gap-3">
                <span aria-hidden="true" className="text-brass-deep">
                  ✓
                </span>
                {item}
              </li>
            ))}
          </ul>
          <ButtonLink to="/about" variant="outline" size="md" className="mt-9">
            Read our story
          </ButtonLink>
        </div>
      </section>
    </>
  );
}
